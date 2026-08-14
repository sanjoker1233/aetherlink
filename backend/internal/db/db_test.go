package db

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// TestMessagePersistence verifies the offline-delivery storage contract the
// hub relies on: a sent message is saved, retrievable, deletable, and does not
// resurrect after a reload from disk.
func TestMessagePersistence(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "db.json")
	s := NewStore(path)

	conv := "conv_persist_test"
	msg := map[string]interface{}{
		"id": "m1", "conversationId": conv, "senderId": "u1",
		"content": "hi", "encrypted": false, "timestamp": int64(123),
	}
	s.SaveMessage(conv, msg)

	got := s.GetMessages(conv)
	if len(got) != 1 {
		t.Fatalf("expected 1 message after save, got %d", len(got))
	}
	if got[0]["id"] != "m1" {
		t.Fatalf("unexpected stored message: %v", got[0])
	}

	// Deleting an existing message empties the thread.
	s.DeleteMessage(conv, "m1")
	if got := s.GetMessages(conv); len(got) != 0 {
		t.Fatalf("expected 0 messages after delete, got %d", len(got))
	}

	// Deleting a missing id must be a safe no-op (no panic, no error).
	s.DeleteMessage(conv, "does-not-exist")

	// Reloading from disk must not resurrect the deleted message.
	s2 := NewStore(path)
	if msgs := s2.GetMessages(conv); len(msgs) != 0 {
		t.Fatalf("reloaded store should have 0 messages, got %d", len(msgs))
	}

	_ = os.Remove(path)
}

// TestWALReplayAfterRestart proves the write-ahead log is the durable source
// of truth: after a handful of mutations (fewer than checkpointInterval, so no
// compact snapshot is written), a brand-new Store opened on the same path must
// recover every write by replaying the WAL — including deletes.
func TestWALReplayAfterRestart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "db.json")
	s := NewStore(path)

	s.SaveUser("reg:alice", map[string]interface{}{"displayName": "Alice"})
	s.SaveUser("reg:bob", map[string]interface{}{"displayName": "Bob"})
	s.SaveContactPair("alice", "bob")

	conv := "conv_wal"
	s.SaveMessage(conv, map[string]interface{}{"id": "m1", "senderId": "alice", "content": "hello"})
	s.SaveMessage(conv, map[string]interface{}{"id": "m2", "senderId": "bob", "content": "hi back"})
	s.DeleteMessage(conv, "m1")

	s.SavePendingContactRequest("req1", map[string]interface{}{"fromUserId": "alice", "toUserId": "bob"})
	s.RemovePendingContactRequest("req1") // req1 here is the request id, not user

	// Simulate a process restart: a fresh Store reads snapshot + replays WAL.
	s2 := NewStore(path)
	if got := s2.GetMessages(conv); len(got) != 1 || got[0]["id"] != "m2" {
		t.Fatalf("replayed messages wrong: %v", got)
	}
	if pairs := s2.GetAllUsers(); pairs["contact:alice:bob"] == nil || pairs["contact:bob:alice"] == nil {
		t.Fatalf("contact pair not replayed: %v", pairs)
	}
	if reqs := s2.GetPendingContactRequests("bob"); len(reqs) != 0 {
		t.Fatalf("removed pending request resurrected: %v", reqs)
	}
	if u := s2.GetUser("reg:alice"); u == nil || u["displayName"] != "Alice" {
		t.Fatalf("user not replayed: %v", u)
	}
}

// TestWALCrashRecoveryTornLine appends a half-written (corrupt) final line to
// the WAL and verifies the next startup skips it instead of failing or
// corrupting state.
func TestWALCrashRecoveryTornLine(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "db.json")
	s := NewStore(path)
	conv := "conv_crash"
	s.SaveMessage(conv, map[string]interface{}{"id": "m1", "content": "safe"})
	s.SaveMessage(conv, map[string]interface{}{"id": "m2", "content": "also safe"})

	// Simulate a crash mid-write: a truncated JSON line at EOF.
	walPath := path + ".wal"
	af, err := os.OpenFile(walPath, os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		t.Fatalf("open wal: %v", err)
	}
	_, _ = af.WriteString(`{"t":"put","c":"messages","k":"conv_crash","v":{"id":"m3","content":"TORN`)
	_ = af.Close()

	s2 := NewStore(path)
	msgs := s2.GetMessages(conv)
	if len(msgs) != 2 {
		t.Fatalf("expected 2 safe messages after torn-line recovery, got %d: %v", len(msgs), msgs)
	}
	for _, m := range msgs {
		if m["id"] == "m3" {
			t.Fatalf("torn message must be skipped, got %v", m)
		}
	}
}

// TestConcurrentWrites proves the store serializes mutations correctly under
// concurrency: many goroutines append messages, none are lost or panic, and a
// restart recovers all of them.
func TestConcurrentWrites(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "db.json")
	s := NewStore(path)
	conv := "conv_conc"
	const workers = 8
	const perWorker = 50
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < perWorker; i++ {
				id := fmt.Sprintf("m_%d_%d", w, i)
				s.SaveMessage(conv, map[string]interface{}{"id": id, "content": "x"})
			}
		}(w)
	}
	wg.Wait()

	got := s.GetMessages(conv)
	if len(got) != workers*perWorker {
		t.Fatalf("expected %d messages, got %d", workers*perWorker, len(got))
	}
	// Restart and confirm durability.
	s2 := NewStore(path)
	if len(s2.GetMessages(conv)) != workers*perWorker {
		t.Fatalf("messages lost after restart")
	}
}
