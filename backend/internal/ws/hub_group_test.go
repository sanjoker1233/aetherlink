package ws

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/cryptmessenger/cryptmessenger-backend/internal/db"
)

// newTestClient builds a minimal Client usable by the hub routing logic
// without a live websocket connection. route()/sendToUser() only touch
// c.send and c.userID, so a nil conn is fine.
func newTestClient(hub *Hub, userID string) *Client {
	return &Client{
		hub:    hub,
		send:   make(chan []byte, 16),
		userID: userID,
		hubID:  userID,
		done:   make(chan struct{}),
	}
}

// waitForMessage reads one frame from the client's send channel or times out.
func waitForMessage(c *Client, timeout time.Duration) (WSMessage, bool) {
	select {
	case raw := <-c.send:
		var msg WSMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			return WSMessage{}, false
		}
		return msg, true
	case <-time.After(timeout):
		return WSMessage{}, false
	}
}

func TestGroupFanOutAndPushHook(t *testing.T) {
	path := "/tmp/hub_group_test_db.json"
	_ = os.Remove(path)
	store := db.NewStore(path)
	defer os.Remove(path)

	convID := "conv:group1"
	store.SaveConversation(map[string]interface{}{
		"id":      convID,
		"type":    "group",
		"members": []interface{}{"alice", "bob", "carol"},
	})

	hub := NewHub()
	hub.SetStore(store)
	var pushCalls []string
	hub.SetPushHook(func(rid, sid string) { pushCalls = append(pushCalls, rid) })
	go hub.Run()

	alice := newTestClient(hub, "alice")
	bob := newTestClient(hub, "bob")
	carol := newTestClient(hub, "carol")

	hub.register <- alice
	hub.register <- bob
	hub.register <- carol
	time.Sleep(50 * time.Millisecond)

	// alice broadcasts a group message.
	raw, _ := json.Marshal(WSMessage{Type: "message", Payload: WSPayload{
		ConversationID: convID, SenderID: "alice", ID: "m1", Content: "hello group",
	}})
	hub.broadcast <- raw
	time.Sleep(50 * time.Millisecond)

	bMsg, bOk := waitForMessage(bob, time.Second)
	cMsg, cOk := waitForMessage(carol, time.Second)
	if !bOk || bMsg.Payload.Content != "hello group" {
		t.Fatalf("bob did not receive group message (ok=%v)", bOk)
	}
	if !cOk || cMsg.Payload.Content != "hello group" {
		t.Fatalf("carol did not receive group message (ok=%v)", cOk)
	}
	if len(pushCalls) != 0 {
		t.Fatalf("unexpected push calls while all members online: %v", pushCalls)
	}

	// Now carol goes offline (unregister). A new message must trigger the
	// push hook for her, while bob (still online) still receives it inline.
	hub.unregister <- carol
	time.Sleep(50 * time.Millisecond)

	raw2, _ := json.Marshal(WSMessage{Type: "message", Payload: WSPayload{
		ConversationID: convID, SenderID: "alice", ID: "m2", Content: "still here?",
	}})
	hub.broadcast <- raw2
	time.Sleep(50 * time.Millisecond)

	if b2, ok := waitForMessage(bob, time.Second); !ok || b2.Payload.Content != "still here?" {
		t.Fatalf("bob did not receive second group message")
	}
	found := false
	for _, rid := range pushCalls {
		if rid == "carol" {
			found = true
		}
	}
	if !found {
		t.Fatalf("push hook not called for offline member carol; calls=%v", pushCalls)
	}
}

func TestNonMemberRejected(t *testing.T) {
	path := "/tmp/hub_group_test_db2.json"
	_ = os.Remove(path)
	store := db.NewStore(path)
	defer os.Remove(path)

	convID := "conv:group2"
	store.SaveConversation(map[string]interface{}{
		"id":      convID,
		"type":    "group",
		"members": []interface{}{"alice", "bob"},
	})

	hub := NewHub()
	hub.SetStore(store)
	var pushCalls []string
	hub.SetPushHook(func(rid, sid string) { pushCalls = append(pushCalls, rid) })
	go hub.Run()

	alice := newTestClient(hub, "alice")
	eve := newTestClient(hub, "eve") // not a member
	hub.register <- alice
	hub.register <- eve
	time.Sleep(50 * time.Millisecond)

	// alice sends a message to the group; eve is NOT a member so she must
	// not receive it even though she is connected.
	raw, _ := json.Marshal(WSMessage{Type: "message", Payload: WSPayload{
		ConversationID: convID, SenderID: "alice", ID: "x1", Content: "secret",
	}})
	hub.broadcast <- raw
	time.Sleep(50 * time.Millisecond)

	if _, ok := waitForMessage(eve, 300*time.Millisecond); ok {
		t.Fatalf("non-member eve incorrectly received a group message")
	}
}
