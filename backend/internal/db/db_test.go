package db

import (
	"os"
	"path/filepath"
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
