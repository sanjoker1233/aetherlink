package db

import (
	"encoding/json"
	"errors"
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

type Store struct {
	mu            sync.RWMutex
	users         map[string]map[string]interface{}
	messages      map[string][]map[string]interface{}
	conversations map[string]map[string]interface{}
	path          string
}

func NewStore(path string) *Store {
	s := &Store{
		users:         make(map[string]map[string]interface{}),
		messages:      make(map[string][]map[string]interface{}),
		conversations: make(map[string]map[string]interface{}),
		path:          path,
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
	s.load()
	return s
}

func (s *Store) SaveUser(userID string, data map[string]interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users[userID] = data
	s.persist()
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
	s.users["push:"+userID] = sub
	s.persist()
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
	s.persist()
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
		s.persist()
	}
}

func (s *Store) SavePendingContactRequest(requestID string, data map[string]interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users["pending_req:"+requestID] = data
	s.persist()
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
	delete(s.users, "pending_req:"+requestID)
	s.persist()
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
	s.users["contact:"+a+":"+b] = data
	s.users["contact:"+b+":"+a] = data
	s.persist()
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
	s.persist()
}

func (s *Store) SavePendingAccept(requestID string, data map[string]interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users["pending_accept:"+requestID] = data
	s.persist()
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
	delete(s.users, "pending_accept:"+requestID)
	s.persist()
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
	s.persist()
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

func (s *Store) load() {
	data, err := os.ReadFile(s.path)
	if err != nil {
		log.Printf("No existing database at %s, starting fresh", s.path)
		return
	}
	// If the DB file pre-existed with lax perms (e.g. from an older build),
	// tighten them silently on read. Defense-in-depth — persist() writes 0600
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

// persist writes the DB atomically: dump JSON to a sibling tmp file with 0600,
// fsync, then rename. Rename on the same filesystem is atomic on POSIX, so
// readers never see a torn write and a crash mid-write can't corrupt the
// canonical file. Perms are 0600 so only the running user can read secrets +
// message ciphertext at rest (previously 0644 world-readable — audit H6).
func (s *Store) persist() {
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

// migrateLegacyIfPresent copies /tmp/cryptmessenger-db.json to the configured
// path (once) and removes the legacy file. Only runs when the new path doesn't
// already have a DB — never overwrites live data. See audit finding H6.
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
