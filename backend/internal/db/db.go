package db

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// legacyPath is the world-readable /tmp location the store used to live at.
// If we find it on startup and no file exists at the new path, we migrate it
// once and remove the legacy file. See audit finding H6.
const legacyPath = "/tmp/cryptmessenger-db.json"

// checkpointInterval controls how many WAL operations accumulate before we
// rewrite the compact snapshot and truncate the WAL. Lower = smaller WAL /
// more frequent full rewrites; higher = larger WAL / fewer rewrites. 200 is a
// comfortable default for a personal messenger.
const checkpointInterval = 200

// walOp is a single append-only mutation recorded in the write-ahead log.
// Replaying the WAL in order reproduces the exact in-memory state, so a crash
// can never lose a committed write and can never observe a torn record (the
// final, possibly partial line is skipped on load).
type walOp struct {
	T    string      `json:"t"`           // put | del | delmsg | delpb
	Coll string      `json:"c,omitempty"` // users | conversations (for put/del)
	Key  string      `json:"k,omitempty"` // key within the collection
	Val  interface{} `json:"v,omitempty"` // value for put
	ID   string      `json:"id,omitempty"` // message id for delmsg
	A    string      `json:"a,omitempty"` // for delpb (RemovePendingRequestsBetween)
	B    string      `json:"b,omitempty"` // for delpb
}

type Store struct {
	mu            sync.RWMutex
	users         map[string]map[string]interface{}
	messages      map[string][]map[string]interface{}
	conversations map[string]map[string]interface{}
	path          string
	walPath       string
	wal           *os.File // append handle; nil if WAL failed to open (degraded)
	opCount       int
}

func NewStore(path string) *Store {
	s := &Store{
		users:         make(map[string]map[string]interface{}),
		messages:      make(map[string][]map[string]interface{}),
		conversations: make(map[string]map[string]interface{}),
		path:          path,
		walPath:       path + ".wal",
	}
	// Ensure the parent directory exists with restrictive perms BEFORE any
	// write. 0700 means only the running user can list/traverse it — critical
	// on multi-user hosts where /tmp/*.json used to be world-readable.
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			log.Printf("db: could not create data dir %s: %v", dir, err)
		} else {
			// Tighten perms if the dir pre-existed with something looser.
			_ = os.Chmod(dir, 0o700)
		}
	}
	s.migrateLegacyIfPresent()
	s.loadSnapshot()
	if err := s.openWAL(); err != nil {
		log.Printf("db: WAL unavailable, falling back to snapshot-only persistence: %v", err)
	}
	return s
}

// openWAL opens the write-ahead log, replays any existing records into the
// in-memory maps (on top of the snapshot already loaded), and keeps the file
// handle positioned at EOF for subsequent appends. Must be called once during
// construction, before any concurrent access.
func (s *Store) openWAL() error {
	f, err := os.OpenFile(s.walPath, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		_ = f.Close()
		return err
	}
	r := bufio.NewReader(f)
	for {
		line, rerr := r.ReadString('\n')
		if len(line) > 0 {
			trimmed := strings.TrimRight(line, "\n")
			if trimmed != "" {
				var op walOp
				if jerr := json.Unmarshal([]byte(trimmed), &op); jerr == nil {
					s.applyOp(op)
				} else {
					// A torn final line from a crash mid-write — skip it.
					// Any other corruption is likewise ignored so a single
					// bad record can't block startup.
					log.Printf("db: skipping unparseable WAL line: %v", jerr)
				}
			}
		}
		if rerr != nil {
			break // EOF or read error
		}
	}
	if _, err := f.Seek(0, io.SeekEnd); err != nil {
		_ = f.Close()
		return err
	}
	s.wal = f
	s.opCount = 0
	return nil
}

// applyOp mutates the in-memory maps only. Used both during WAL replay and
// (indirectly) mirrored by the public methods via appendOp. Callers that call
// it directly (WAL replay at startup) must NOT hold s.mu.
func (s *Store) applyOp(op walOp) {
	switch op.T {
	case "put":
		switch op.Coll {
		case "users":
			if m := toMap(op.Val); m != nil {
				s.users[op.Key] = m
			}
		case "conversations":
			if m := toMap(op.Val); m != nil {
				s.conversations[op.Key] = m
			}
		case "messages":
			if m := toMap(op.Val); m != nil {
				s.messages[op.Key] = append(s.messages[op.Key], m)
			}
		}
	case "del":
		switch op.Coll {
		case "users":
			delete(s.users, op.Key)
		case "conversations":
			delete(s.conversations, op.Key)
		}
	case "delmsg":
		msgs, ok := s.messages[op.Key]
		if !ok {
			return
		}
		out := msgs[:0]
		removed := false
		for _, m := range msgs {
			if idStr, _ := m["id"].(string); idStr == op.ID {
				removed = true
				continue
			}
			out = append(out, m)
		}
		if removed {
			s.messages[op.Key] = out
		}
	case "delpb":
		// RemovePendingRequestsBetween(a, b)
		for k, v := range s.users {
			if len(k) > 12 && k[:12] == "pending_req:" {
				from, _ := v["fromUserId"].(string)
				to, _ := v["toUserId"].(string)
				if (from == op.A && to == op.B) || (from == op.B && to == op.A) {
					delete(s.users, k)
				}
			}
		}
	}
}

// appendOp records a mutation in the WAL (durable, append-only) and advances
// the checkpoint counter. MUST be called while holding s.mu — the public
// methods already do.
func (s *Store) appendOp(op walOp) {
	if s.wal == nil {
		return // degraded mode: in-memory state still correct
	}
	b, err := json.Marshal(op)
	if err != nil {
		log.Printf("db: could not marshal WAL op: %v", err)
		return
	}
	b = append(b, '\n')
	if _, err := s.wal.Write(b); err != nil {
		log.Printf("db: could not write WAL op: %v", err)
		return
	}
	if err := s.wal.Sync(); err != nil {
		log.Printf("db: WAL fsync failed: %v", err)
	}
	s.opCount++
	if s.opCount >= checkpointInterval {
		s.snapshot()
		if err := os.Truncate(s.walPath, 0); err == nil {
			_, _ = s.wal.Seek(0, io.SeekEnd)
		}
		s.opCount = 0
	}
}

// Checkpoint forces a compact snapshot + WAL truncation. Exposed for tests and
// for orderly shutdown (call under no lock — it takes the lock itself).
func (s *Store) Checkpoint() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot()
	if s.wal != nil {
		if err := os.Truncate(s.walPath, 0); err == nil {
			_, _ = s.wal.Seek(0, io.SeekEnd)
		}
		s.opCount = 0
	}
}

func toMap(v interface{}) map[string]interface{} {
	if m, ok := v.(map[string]interface{}); ok {
		return m
	}
	return nil
}

func (s *Store) SaveUser(userID string, data map[string]interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users[userID] = data
	s.appendOp(walOp{T: "put", Coll: "users", Key: userID, Val: data})
}

func (s *Store) GetUser(userID string) map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.users[userID]
}

// Push subscriptions (WebPush) are stored per user under a dedicated key.
func (s *Store) SavePushSubscription(userID string, sub map[string]interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := "push:" + userID
	s.users[key] = sub
	s.appendOp(walOp{T: "put", Coll: "users", Key: key, Val: sub})
}

func (s *Store) GetPushSubscription(userID string) map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.users["push:"+userID]
}

func (s *Store) GetAllUsers() map[string]map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cp := make(map[string]map[string]interface{})
	for k, v := range s.users {
		cp[k] = v
	}
	return cp
}

func (s *Store) SearchUsers(query string) []map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if query == "" {
		return nil
	}
	q := strings.ToLower(query)
	var results []map[string]interface{}
	for k, v := range s.users {
		if len(k) < 4 || k[:4] != "reg:" {
			continue
		}
		name, _ := v["displayName"].(string)
		fp, _ := v["fingerprint"].(string)
		if strings.Contains(strings.ToLower(name), q) || strings.Contains(strings.ToLower(fp), q) {
			results = append(results, v)
		}
	}
	return results
}

func (s *Store) SaveMessage(convID string, msg map[string]interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.messages[convID] = append(s.messages[convID], msg)
	s.appendOp(walOp{T: "put", Coll: "messages", Key: convID, Val: msg})
}

func (s *Store) GetMessages(convID string) []map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.messages[convID]
}

// DeleteMessage removes a single message (by id) from a conversation thread.
// Used when a sender "unsends" a message so an offline recipient who
// reconnects later does not receive a message that was already deleted.
func (s *Store) DeleteMessage(convID, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	msgs, ok := s.messages[convID]
	if !ok {
		return
	}
	out := msgs[:0]
	removed := false
	for _, m := range msgs {
		if idStr, _ := m["id"].(string); idStr == id {
			removed = true
			continue
		}
		out = append(out, m)
	}
	if removed {
		s.messages[convID] = out
		s.appendOp(walOp{T: "delmsg", Key: convID, ID: id})
	}
}

func (s *Store) SavePendingContactRequest(requestID string, data map[string]interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := "pending_req:" + requestID
	s.users[key] = data
	s.appendOp(walOp{T: "put", Coll: "users", Key: key, Val: data})
}

func (s *Store) GetPendingContactRequests(userID string) []map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var results []map[string]interface{}
	for k, v := range s.users {
		if len(k) > 12 && k[:12] == "pending_req:" {
			toUser, _ := v["toUserId"].(string)
			if toUser == userID {
				results = append(results, v)
			}
		}
	}
	return results
}

func (s *Store) RemovePendingContactRequest(requestID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := "pending_req:" + requestID
	delete(s.users, key)
	s.appendOp(walOp{T: "del", Coll: "users", Key: key})
}

// SaveContactPair records a mutual contact relationship between two users so
// that subsequent private (DM) messages between them are authorized
// server-side. authorizedRecipient() consults these keys, and the client
// generates DM conversation IDs of the form "<uidA>__<uidB>" (not the
// "conv:<a>:<b>" shape the legacy membership check expects), so without this
// record two online contacts could never exchange messages. Written when a
// contact request is accepted.
func (s *Store) SaveContactPair(a, b string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data := map[string]interface{}{"a": a, "b": b, "since": time.Now().Unix()}
	ka, kb := "contact:"+a+":"+b, "contact:"+b+":"+a
	s.users[ka] = data
	s.users[kb] = data
	s.appendOp(walOp{T: "put", Coll: "users", Key: ka, Val: data})
	s.appendOp(walOp{T: "put", Coll: "users", Key: kb, Val: data})
}

// RemovePendingRequestsBetween deletes any stored pending contact requests
// exchanged in either direction between a and b. Called when a request is
// accepted so it is not redelivered to the recipient on their next connect.
func (s *Store) RemovePendingRequestsBetween(a, b string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range s.users {
		if len(k) > 12 && k[:12] == "pending_req:" {
			from, _ := v["fromUserId"].(string)
			to, _ := v["toUserId"].(string)
			if (from == a && to == b) || (from == b && to == a) {
				delete(s.users, k)
			}
		}
	}
	s.appendOp(walOp{T: "delpb", A: a, B: b})
}

func (s *Store) SavePendingAccept(requestID string, data map[string]interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := "pending_accept:" + requestID
	s.users[key] = data
	s.appendOp(walOp{T: "put", Coll: "users", Key: key, Val: data})
}

func (s *Store) GetPendingAccepts(userID string) []map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var results []map[string]interface{}
	for k, v := range s.users {
		if len(k) > 15 && k[:15] == "pending_accept:" {
			toUser, _ := v["toUserId"].(string)
			if toUser == userID {
				results = append(results, v)
			}
		}
	}
	return results
}

func (s *Store) RemovePendingAccept(requestID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := "pending_accept:" + requestID
	delete(s.users, key)
	s.appendOp(walOp{T: "del", Coll: "users", Key: key})
}

// --- Conversations (group + DM membership) ---
// A conversation is the source of truth for who may exchange messages. DMs
// created before this table existed still work via the legacy "conv:<uidA>:<uidB>"
// string convention (see hub.authorizedRecipient fallback), but all new
// conversations (including groups) are created through the API and stored here.

func (s *Store) SaveConversation(conv map[string]interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conversations == nil {
		s.conversations = make(map[string]map[string]interface{})
	}
	id, _ := conv["id"].(string)
	if id == "" {
		return
	}
	// Normalize members to []interface{} so the membership checks
	// (isMember / GetConversationMembers) — which type-assert the stored slice
	// as []interface{} — work whether the conversation came from JSON (where
	// arrays unmarshal as []interface{}) or was built in Go (where it may be a
	// typed []string). Without this, API-created conversations always report
	// "no members" and message sends are rejected with 403.
	if mem, ok := conv["members"].([]string); ok {
		norm := make([]interface{}, len(mem))
		for i, m := range mem {
			norm[i] = m
		}
		conv["members"] = norm
	}
	s.conversations[id] = conv
	s.appendOp(walOp{T: "put", Coll: "conversations", Key: id, Val: conv})
}

func (s *Store) GetConversation(convID string) map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.conversations[convID]
}

func (s *Store) GetConversationMembers(convID string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	conv := s.conversations[convID]
	if conv == nil {
		return nil
	}
	members, _ := conv["members"].([]interface{})
	out := make([]string, 0, len(members))
	for _, m := range members {
		if uid, ok := m.(string); ok {
			out = append(out, uid)
		}
	}
	return out
}

func (s *Store) IsConversationMember(convID, userID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	conv := s.conversations[convID]
	if conv == nil {
		return false
	}
	return isMember(conv, userID)
}

func (s *Store) ListConversations(userID string) []map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []map[string]interface{}
	for _, conv := range s.conversations {
		if isMember(conv, userID) {
			out = append(out, conv)
		}
	}
	return out
}

// isMember is the lock-free helper used inside already-locked methods.
func isMember(conv map[string]interface{}, userID string) bool {
	members, _ := conv["members"].([]interface{})
	for _, m := range members {
		if uid, ok := m.(string); ok && uid == userID {
			return true
		}
	}
	return false
}

// loadSnapshot reads the compact JSON snapshot (users + messages +
// conversations) into memory. It is the base state onto which the WAL is
// replayed. A missing snapshot simply means a fresh store.
func (s *Store) loadSnapshot() {
	data, err := os.ReadFile(s.path)
	if err != nil {
		log.Printf("No existing database at %s, starting fresh", s.path)
		return
	}
	// If the DB file pre-existed with lax perms (e.g. from an older build),
	// tighten them silently on read. Defense-in-depth — snapshot() writes 0600
	// but the file we just read might have been left over from before.
	_ = os.Chmod(s.path, 0o600)
	var store struct {
		Users         map[string]map[string]interface{}   `json:"users"`
		Messages      map[string][]map[string]interface{} `json:"messages"`
		Conversations map[string]map[string]interface{}   `json:"conversations"`
	}
	if err := json.Unmarshal(data, &store); err != nil {
		log.Printf("Error loading database: %v", err)
		return
	}
	// Guard against nil maps from a `{}`/truncated/partial DB file — writing
	// to a nil map panics ("assignment to entry in nil map") and was remotely
	// triggerable via /api/auth/register.
	if store.Users != nil {
		s.users = store.Users
	} else {
		s.users = make(map[string]map[string]interface{})
	}
	if store.Messages != nil {
		s.messages = store.Messages
	} else {
		s.messages = make(map[string][]map[string]interface{})
	}
	if s.conversations == nil {
		s.conversations = make(map[string]map[string]interface{})
	}
	if store.Conversations != nil {
		s.conversations = store.Conversations
	}
	log.Printf("Loaded %d users, %d conversations and %d message threads", len(s.users), len(s.conversations), len(s.messages))
}

// snapshot writes the full compact JSON file atomically: dump JSON to a sibling
// tmp file with 0600, fsync, then rename. Rename on the same filesystem is
// atomic on POSIX, so readers never see a torn write and a crash mid-write
// can't corrupt the canonical file. Perms are 0600 so only the running user
// can read secrets + message ciphertext at rest (previously 0644
// world-readable — audit H6).
func (s *Store) snapshot() {
	data, err := json.MarshalIndent(map[string]interface{}{
		"users":         s.users,
		"messages":      s.messages,
		"conversations": s.conversations,
	}, "", "  ")
	if err != nil {
		log.Printf("Error marshaling database: %v", err)
		return
	}
	tmp := s.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		log.Printf("Error opening database tmp file: %v", err)
		return
	}
	if _, err := f.Write(data); err != nil {
		log.Printf("Error writing database: %v", err)
		_ = f.Close()
		_ = os.Remove(tmp)
		return
	}
	if err := f.Sync(); err != nil {
		log.Printf("Warning: database fsync failed: %v", err)
	}
	if err := f.Close(); err != nil {
		log.Printf("Error closing database tmp file: %v", err)
		_ = os.Remove(tmp)
		return
	}
	if err := os.Rename(tmp, s.path); err != nil {
		log.Printf("Error renaming database: %v", err)
		_ = os.Remove(tmp)
	}
}

// migrateLegacyIfPresent check: copy /tmp/cryptmessenger-db.json to the
// configured path (once) and remove the legacy file. Only runs when the new
// path doesn't already have a DB — never overwrites live data. See audit H6.
func (s *Store) migrateLegacyIfPresent() {
	if s.path == legacyPath {
		return // caller explicitly asked for the legacy path — nothing to do
	}
	if _, err := os.Stat(s.path); err == nil {
		return // new location already populated; don't touch it
	} else if !errors.Is(err, os.ErrNotExist) {
		log.Printf("db: stat new path failed: %v", err)
		return
	}
	src, err := os.ReadFile(legacyPath)
	if err != nil {
		return // no legacy file — normal on fresh installs
	}
	if err := os.WriteFile(s.path, src, 0o600); err != nil {
		log.Printf("db: legacy migration write failed: %v", err)
		return
	}
	if err := os.Remove(legacyPath); err != nil {
		log.Printf("db: legacy migration succeeded but could not remove old file %s: %v", legacyPath, err)
	} else {
		log.Printf("db: migrated legacy database %s -> %s (0600)", legacyPath, s.path)
	}
}
