package ws

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/cryptmessenger/cryptmessenger-backend/internal/db"
)

// TestMessageDeleteForEveryone verifies that only the original author can
// unsend a message, and that the delete is relayed to every other member of
// the conversation (but never echoed back to the deleter).
func drain(c *Client) {
	for {
		select {
		case <-c.send:
		default:
			return
		}
	}
}

// rmTestDB removes both the snapshot and the WAL sidecar so each test starts
// from a truly empty store. The WAL (path + ".wal") persists across separate
// `go test` process invocations; without clearing it, openWAL() replays stale
// ops from a previous run into an otherwise-fresh store.
func rmTestDB(path string) {
	_ = os.Remove(path)
	_ = os.Remove(path + ".wal")
}

func TestMessageDeleteForEveryone(t *testing.T) {
	path := "/tmp/hub_delete_test_db.json"
	rmTestDB(path)
	store := db.NewStore(path)
	defer os.Remove(path)

	convID := "conv:dm"
	store.SaveConversation(map[string]interface{}{
		"id":      convID,
		"type":    "dm",
		"members": []interface{}{"alice", "bob"},
	})

	hub := NewHub()
	hub.SetStore(store)
	go hub.Run()

	alice := newTestClient(hub, "alice")
	bob := newTestClient(hub, "bob")
	hub.register <- alice
	hub.register <- bob
	time.Sleep(50 * time.Millisecond)

	// alice sends a message (records authorship in msgOwners).
	raw, _ := json.Marshal(WSMessage{Type: "message", Payload: WSPayload{
		ConversationID: convID, SenderID: "alice", ID: "m1", Content: "delete me",
	}})
	hub.broadcast <- raw
	time.Sleep(50 * time.Millisecond)
	drain(alice)
	drain(bob)

	// alice unsends it: bob must receive the delete, alice must not.
	del, _ := json.Marshal(WSMessage{Type: "message_delete", Payload: WSPayload{
		ConversationID: convID, SenderID: "alice", ID: "m1",
	}})
	hub.broadcast <- del
	time.Sleep(50 * time.Millisecond)

	bDel, bOk := waitForMessage(bob, time.Second)
	if !bOk || bDel.Type != "message_delete" || bDel.Payload.ID != "m1" {
		t.Fatalf("bob did not receive the unsend (ok=%v type=%s id=%s)", bOk, bDel.Type, bDel.Payload.ID)
	}
	if _, aOk := waitForMessage(alice, 300*time.Millisecond); aOk {
		t.Fatalf("deleter (alice) incorrectly received her own unsend echo")
	}

	// bob tries to unsend a message she did not author: must be dropped.
	drain(alice)
	drain(bob)
	delBob, _ := json.Marshal(WSMessage{Type: "message_delete", Payload: WSPayload{
		ConversationID: convID, SenderID: "bob", ID: "m1",
	}})
	hub.broadcast <- delBob
	time.Sleep(50 * time.Millisecond)

	if _, ok := waitForMessage(alice, 300*time.Millisecond); ok {
		t.Fatalf("non-author bob's unsend was relayed to alice (authorship not enforced)")
	}
	if _, ok := waitForMessage(bob, 300*time.Millisecond); ok {
		t.Fatalf("non-author bob's unsend echoed back to bob")
	}
}

// TestTypingRelayPreservesFlag verifies the previously-broken typing relay:
// the Typing boolean must survive the round-trip to the peer.
func TestTypingRelayPreservesFlag(t *testing.T) {
	path := "/tmp/hub_typing_test_db.json"
	rmTestDB(path)
	store := db.NewStore(path)
	defer os.Remove(path)

	convID := "conv:dm"
	store.SaveConversation(map[string]interface{}{
		"id":      convID,
		"type":    "dm",
		"members": []interface{}{"alice", "bob"},
	})

	hub := NewHub()
	hub.SetStore(store)
	go hub.Run()

	alice := newTestClient(hub, "alice")
	bob := newTestClient(hub, "bob")
	hub.register <- alice
	hub.register <- bob
	time.Sleep(50 * time.Millisecond)

	// alice starts typing.
	typing, _ := json.Marshal(WSMessage{Type: "typing", Payload: WSPayload{
		ConversationID: convID, SenderID: "alice", RecipientID: "bob", Typing: true,
	}})
	hub.broadcast <- typing
	time.Sleep(50 * time.Millisecond)

	bTyping, bOk := waitForMessage(bob, time.Second)
	if !bOk || bTyping.Type != "typing" {
		t.Fatalf("bob did not receive typing event")
	}
	if !bTyping.Payload.Typing {
		t.Fatalf("typing flag was dropped in relay (Typing=%v) — regression of the original bug", bTyping.Payload.Typing)
	}
	if bTyping.Payload.ConversationID != convID {
		t.Fatalf("typing event missing conversationId")
	}

	// alice stops typing.
	stop, _ := json.Marshal(WSMessage{Type: "typing", Payload: WSPayload{
		ConversationID: convID, SenderID: "alice", RecipientID: "bob", Typing: false,
	}})
	hub.broadcast <- stop
	time.Sleep(50 * time.Millisecond)

	bStop, _ := waitForMessage(bob, time.Second)
	if bStop.Payload.Typing {
		t.Fatalf("stop-typing flag not relayed correctly")
	}
}

// TestContactDecline verifies the decline path end-to-end through the hub:
// a recipient who declines a contact request has the server-side pending
// request removed (so it is NOT redelivered on reconnect) and the original
// sender is notified so their outgoing "pending" state clears.
func TestContactDecline(t *testing.T) {
	path := "/tmp/hub_decline_test_db.json"
	rmTestDB(path)
	store := db.NewStore(path)
	defer os.Remove(path)

	hub := NewHub()
	hub.SetStore(store)
	go hub.Run()

	carol := newTestClient(hub, "carol") // original sender
	dave := newTestClient(hub, "dave")   // recipient
	hub.register <- carol
	hub.register <- dave
	time.Sleep(50 * time.Millisecond)

	// carol sends a contact request to dave.
	req, _ := json.Marshal(WSMessage{Type: "contact_request", Payload: WSPayload{
		ContactID: "req1", FromUserID: "carol", ToUserID: "dave",
		DisplayName: "Carol", PublicKey: "pk", Fingerprint: "fp",
	}})
	hub.broadcast <- req
	time.Sleep(50 * time.Millisecond)
	drain(dave) // consume the live delivery to dave

	if got := store.GetPendingContactRequests("dave"); len(got) != 1 {
		t.Fatalf("expected 1 pending request for dave, got %d", len(got))
	}

	// dave declines.
	dec, _ := json.Marshal(WSMessage{Type: "contact_decline", Payload: WSPayload{
		ContactID: "req1", FromUserID: "dave", ToUserID: "carol",
		DisplayName: "Dave",
	}})
	hub.broadcast <- dec
	time.Sleep(50 * time.Millisecond)

	// Server-side pending request must be gone → not redelivered on reconnect.
	if got := store.GetPendingContactRequests("dave"); len(got) != 0 {
		t.Fatalf("pending request not removed after decline: %d", len(got))
	}
	// carol (original sender) must be notified of the decline.
	cDec, cOk := waitForMessage(carol, time.Second)
	if !cOk || cDec.Type != "contact_decline" {
		t.Fatalf("carol did not receive contact_decline (ok=%v type=%s)", cOk, cDec.Type)
	}
}

// waitForType drains a client's send channel until it finds a frame of the
// given type or the timeout elapses. Useful when several frames may arrive in
// an order we don't want to assert strictly.
func waitForType(c *Client, typ string, timeout time.Duration) (WSMessage, bool) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		select {
		case raw := <-c.send:
			var m WSMessage
			if json.Unmarshal(raw, &m) == nil && m.Type == typ {
				return m, true
			}
		default:
		}
		time.Sleep(10 * time.Millisecond)
	}
	return WSMessage{}, false
}

// TestEphemeralBurnAfterRead verifies the core "disappearing message" contract:
// when the recipient reads an ephemeral message, the server deletes it and
// tells BOTH conversation members to drop it from their UI (message_expire).
func TestEphemeralBurnAfterRead(t *testing.T) {
	path := "/tmp/hub_ephemeral_test_db.json"
	rmTestDB(path)
	_ = os.Remove(path + ".wal")
	store := db.NewStore(path)
	defer os.Remove(path)

	convID := "conv:dm"
	store.SaveConversation(map[string]interface{}{
		"id":      convID,
		"type":    "dm",
		"members": []interface{}{"alice", "bob"},
	})

	hub := NewHub()
	hub.SetStore(store)
	go hub.Run()

	alice := newTestClient(hub, "alice")
	bob := newTestClient(hub, "bob")
	hub.register <- alice
	hub.register <- bob
	time.Sleep(50 * time.Millisecond)

	// alice sends an ephemeral message.
	raw, _ := json.Marshal(WSMessage{Type: "message", Payload: WSPayload{
		ConversationID: convID, SenderID: "alice", RecipientID: "bob",
		ID: "m1", Content: "secret", Ephemeral: true, TTL: 0,
	}})
	hub.broadcast <- raw
	time.Sleep(50 * time.Millisecond)
	drain(alice)
	drain(bob)

	// It is persisted server-side until read.
	if got := store.GetMessages(convID); len(got) != 1 {
		t.Fatalf("expected 1 persisted message, got %d", len(got))
	}

	// bob reads it (read receipt / "Vu").
	read, _ := json.Marshal(WSMessage{Type: "message_read", Payload: WSPayload{
		ConversationID: convID, SenderID: "bob", RecipientID: "alice",
		MessageIDs: []string{"m1"},
	}})
	hub.broadcast <- read
	time.Sleep(100 * time.Millisecond)

	// Gone from the server.
	if got := store.GetMessages(convID); len(got) != 0 {
		t.Fatalf("ephemeral message was not deleted after read: %d remain", len(got))
	}
	// Both members are told to expire it from their UI.
	aExp, aOk := waitForType(alice, "message_expire", time.Second)
	if !aOk || aExp.Payload.ID != "m1" {
		t.Fatalf("alice did not receive message_expire (ok=%v id=%s)", aOk, aExp.Payload.ID)
	}
	bExp, bOk := waitForType(bob, "message_expire", time.Second)
	if !bOk || bExp.Payload.ID != "m1" {
		t.Fatalf("bob did not receive message_expire (ok=%v id=%s)", bOk, bExp.Payload.ID)
	}
	// A non-ephemeral message must NOT be deleted on read.
	raw2, _ := json.Marshal(WSMessage{Type: "message", Payload: WSPayload{
		ConversationID: convID, SenderID: "alice", RecipientID: "bob",
		ID: "m2", Content: "keep", Ephemeral: false,
	}})
	hub.broadcast <- raw2
	time.Sleep(50 * time.Millisecond)
	drain(alice)
	drain(bob)
	read2, _ := json.Marshal(WSMessage{Type: "message_read", Payload: WSPayload{
		ConversationID: convID, SenderID: "bob", RecipientID: "alice",
		MessageIDs: []string{"m2"},
	}})
	hub.broadcast <- read2
	time.Sleep(100 * time.Millisecond)
	if got := store.GetMessages(convID); len(got) != 1 {
		t.Fatalf("non-ephemeral message wrongly deleted on read: %d remain", len(got))
	}
}

// TestEphemeralTTLJanitor verifies that an ephemeral message whose TTL has
// elapsed without being read is purged by the maintenance sweep, so it can
// never accumulate on the server if the recipient never reads it.
func TestEphemeralTTLJanitor(t *testing.T) {
	path := "/tmp/hub_ephemeral_ttl_test_db.json"
	rmTestDB(path)
	_ = os.Remove(path + ".wal")
	store := db.NewStore(path)
	defer os.Remove(path)

	convID := "conv:dm"
	store.SaveConversation(map[string]interface{}{
		"id":      convID,
		"type":    "dm",
		"members": []interface{}{"alice", "bob"},
	})
	// An ephemeral message sent 10s ago with a 1s TTL is well past expiry.
	store.SaveMessage(convID, map[string]interface{}{
		"id":          "e1",
		"conversationId": convID,
		"senderId":    "alice",
		"recipientId": "bob",
		"ephemeral":   true,
		"ttl":         float64(1),
		"timestamp":   float64(time.Now().Unix() - 10),
	})
	// A non-expired (or non-ephemeral) message must survive the sweep.
	store.SaveMessage(convID, map[string]interface{}{
		"id":        "keep1",
		"ephemeral": false,
		"timestamp": float64(time.Now().Unix()),
	})

	hub := NewHub()
	hub.SetStore(store)
	hub.purgeExpiredEphemeral()

	if got := store.GetMessages(convID); len(got) != 1 {
		t.Fatalf("expected exactly 1 surviving message after TTL sweep, got %d", len(got))
	}
	if got := store.GetMessages(convID); got[0]["id"] != "keep1" {
		t.Fatalf("wrong message survived the TTL sweep: id=%v", got[0]["id"])
	}
}
