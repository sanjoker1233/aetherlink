package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"
)

type Store interface {
	SavePendingContactRequest(requestID string, data map[string]interface{})
	GetPendingContactRequests(userID string) []map[string]interface{}
	RemovePendingContactRequest(requestID string)
	SaveContactPair(a, b string)
	RemovePendingRequestsBetween(a, b string)
	SavePendingAccept(requestID string, data map[string]interface{})
	GetPendingAccepts(userID string) []map[string]interface{}
	RemovePendingAccept(requestID string)
	GetUser(userID string) map[string]interface{}
	GetConversationMembers(convID string) []string
	IsConversationMember(convID, userID string) bool
	// Message persistence for offline / multi-device delivery.
	SaveMessage(convID string, msg map[string]interface{})
	GetMessages(convID string) []map[string]interface{}
	DeleteMessage(convID, id string)
	ListConversations(userID string) []map[string]interface{}
	SaveConversation(conv map[string]interface{})
}

// allowedWSOrigins is populated at package init from ALLOWED_ORIGINS.
// An unset env var falls back to localhost dev origins. A wildcard is refused —
// see audit finding C5 (cross-site WebSocket hijack + full user impersonation).
var allowedWSOrigins = loadAllowedWSOrigins()

func loadAllowedWSOrigins() map[string]struct{} {
	raw := os.Getenv("ALLOWED_ORIGINS")
	out := map[string]struct{}{}
	if raw == "" {
		out["http://localhost:3000"] = struct{}{}
		out["http://127.0.0.1:3000"] = struct{}{}
		return out
	}
	for _, p := range strings.Split(raw, ",") {
		p = strings.TrimSpace(p)
		if p == "" || p == "*" {
			continue
		}
		out[p] = struct{}{}
	}
	return out
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Same-origin (or no Origin header, e.g. non-browser clients on
		// loopback) is fine; otherwise the Origin must be on the allowlist.
		// Without this any website could open an authenticated WS to a
		// logged-in user's session.
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" {
			return false
		}
		_, ok := allowedWSOrigins[origin]
		return ok
	},
}

type WSPayload struct {
	ID             string `json:"id,omitempty"`
	ConversationID string `json:"conversationId,omitempty"`
	SenderID       string `json:"senderId,omitempty"`
	RecipientID    string `json:"recipientId,omitempty"`
	Content        string `json:"content,omitempty"`
	Encrypted      bool   `json:"encrypted,omitempty"`
	Timestamp      int64  `json:"timestamp,omitempty"`
	Status         string `json:"status,omitempty"`

	ContactID    string `json:"contactId,omitempty"`
	FromUserID   string `json:"fromUserId,omitempty"`
	ToUserID     string `json:"toUserId,omitempty"`
	DisplayName  string `json:"displayName,omitempty"`
	PublicKey    string `json:"publicKey,omitempty"`
	Fingerprint  string `json:"fingerprint,omitempty"`

	EncryptedKey string `json:"encryptedKey,omitempty"`
	IV           string `json:"iv,omitempty"`

	// Ephemeral messages (Snapchat-style) carry a server-agnostic TTL the
	// recipient honors regardless of their own disappearing-message setting.
	Ephemeral bool  `json:"ephemeral,omitempty"`
	TTL       int64 `json:"ttl,omitempty"`

	// MessageIDs lists the messages a read-receipt ("Vu") applies to.
	MessageIDs []string `json:"messageIds,omitempty"`

	// Recipients holds per-member ciphertext for group conversations. Each
	// entry is keyed by recipient userID and carries that member's own
	// content/encryptedKey/iv. The hub relays the entire payload to every
	// member; each client decrypts only its own entry. Absent for 1:1 DMs.
	Recipients map[string]map[string]string `json:"recipients,omitempty"`

	Token string `json:"token,omitempty"`

	// Typing presence: true while the peer is composing a message, false when
	// they stop. Relayed verbatim between peers so the recipient can show a
	// "typing…" indicator. (Was previously dropped because WSPayload had no
	// Typing field — the boolean never survived the round-trip.)
	Typing bool `json:"typing,omitempty"`

	// Presence: broadcast when a user connects/disconnects so peers can show
	// a real online/offline indicator in the contact list.
	PresenceUserID string `json:"presenceUserId,omitempty"`
	PresenceStatus string `json:"presenceStatus,omitempty"`
}

type WSMessage struct {
	Type    string    `json:"type"`
	Payload WSPayload `json:"payload"`
}

type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	userID string
	hubID  string
	// done is closed exactly once (via close()) when the client is retired.
	// Producers select on it so they never write to / close a dead channel.
	done      chan struct{}
	closeOnce sync.Once
}

// close retires the client. Safe to call from multiple goroutines.
// It never closes c.send — only writePump does that.
func (c *Client) close() {
	c.closeOnce.Do(func() { close(c.done) })
}

type Hub struct {
	clients    map[string]*Client
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
	store      Store
	// pushHook is invoked when a message targets a user who has no live WS
	// connection, so the caller can deliver a WebPush notification instead.
	pushHook func(recipientID, senderID string)

	// msgOwners records the authenticated sender of each live message so that
	// only the original author can later "delete for everyone" it. route()
	// runs on the single hub goroutine, so this map needs no extra locking.
	msgOwners map[string]string

	// sendLimiters rate-limits message/typing frames per user to prevent a
	// single client from flooding the hub or its peers.
	limitMu  sync.Mutex
	limiters map[string]*rate.Limiter
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		msgOwners:  make(map[string]string),
		limiters:   make(map[string]*rate.Limiter),
	}
}

func (h *Hub) SetStore(s Store) {
	h.store = s
}

// SetPushHook registers the callback used to notify offline recipients.
func (h *Hub) SetPushHook(f func(recipientID, senderID string)) {
	h.pushHook = f
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			old, exists := h.clients[client.userID]
			if exists && old != client {
				old.close()
				old.conn.Close()
			}
			h.clients[client.userID] = client
			h.mu.Unlock()

			// Deliver pending contact requests and accepts
			var deliveredReq, deliveredAccept int
			if h.store != nil {
				pending := h.store.GetPendingContactRequests(client.userID)
				for _, req := range pending {
					h.sendToClient(client, "contact_request", WSPayload{
						FromUserID:  toStr(req["fromUserId"]),
						ToUserID:    toStr(req["toUserId"]),
						DisplayName: toStr(req["displayName"]),
						PublicKey:   toStr(req["publicKey"]),
						Fingerprint: toStr(req["fingerprint"]),
					})
					if id, ok := req["id"].(string); ok {
						h.store.RemovePendingContactRequest(id)
					}
					deliveredReq++
				}
				accepts := h.store.GetPendingAccepts(client.userID)
				for _, acc := range accepts {
					h.sendToClient(client, "contact_accept", WSPayload{
						FromUserID:     toStr(acc["fromUserId"]),
						ToUserID:       toStr(acc["toUserId"]),
						DisplayName:    toStr(acc["displayName"]),
						PublicKey:      toStr(acc["publicKey"]),
						Fingerprint:    toStr(acc["fingerprint"]),
						ConversationID: toStr(acc["conversationId"]),
					})
					if id, ok := acc["id"].(string); ok {
						h.store.RemovePendingAccept(id)
					}
					deliveredAccept++
				}
			}

			// Replay any messages persisted while this user was offline (or on a
			// different device). Delivered as "message_sync" so the client merges
			// them silently — no duplicate OS notification for historical messages.
			if h.store != nil {
				for _, conv := range h.store.ListConversations(client.userID) {
					cid, _ := conv["id"].(string)
					if cid == "" {
						continue
					}
					for _, m := range h.store.GetMessages(cid) {
						b, _ := json.Marshal(m)
						var p WSPayload
						if json.Unmarshal(b, &p) == nil {
							h.sendToClient(client, "message_sync", p)
						}
					}
				}
			}

			log.Printf("[WS] %s connected (delivered %d requests, %d accepts)", client.userID, deliveredReq, deliveredAccept)
			// Tell peers who share a conversation that this user is now online.
			h.broadcastPresence(client.userID, "online")

		case client := <-h.unregister:
			h.mu.Lock()
			if cur, ok := h.clients[client.userID]; ok && cur == client {
				delete(h.clients, client.userID)
				client.close()
			}
			h.mu.Unlock()
			log.Printf("[WS] %s disconnected", client.userID)
			// Tell peers this user went offline so their indicator updates.
			h.broadcastPresence(client.userID, "offline")

		case raw := <-h.broadcast:
			var msg WSMessage
			if err := json.Unmarshal(raw, &msg); err != nil {
				continue
			}
			h.route(msg)
		}
	}
}

func (h *Hub) route(msg WSMessage) {
	switch msg.Type {
		case "message":
			if !h.allowSend(msg.Payload.SenderID) {
				log.Printf("[WS] dropping message from %s: rate limited", msg.Payload.SenderID)
				return
			}
			if msg.Payload.ConversationID == "" || msg.Payload.SenderID == "" {
			return
		}
		ack := WSPayload{ID: msg.Payload.ID, Status: "delivered", Timestamp: now()}
		h.sendToUser(msg.Payload.SenderID, "message_ack", ack)

		// Record authorship so only the sender may later delete this message
		// for everyone (see the message_delete case below).
		h.msgOwners[msg.Payload.ID] = msg.Payload.SenderID

		// Persist the message so an offline recipient (or a second device)
		// can retrieve it on (re)connect. The body is end-to-end encrypted;
		// the server stores only ciphertext it could not read even if it tried.
		if h.store != nil {
			if b, err := json.Marshal(msg.Payload); err == nil {
				var m map[string]interface{}
				if json.Unmarshal(b, &m) == nil && m != nil {
					h.store.SaveMessage(msg.Payload.ConversationID, m)
				}
			}
			// Auto-register a 1:1 DM conversation server-side (first time a
			// message is sent) so the recipient's ListConversations — used to
			// replay offline messages — includes it. Groups are already
			// registered through the API, so we only do this for plain DMs
			// (single recipient, no per-member "recipients" map).
			if !h.store.IsConversationMember(msg.Payload.ConversationID, msg.Payload.SenderID) &&
				msg.Payload.RecipientID != "" && len(msg.Payload.Recipients) == 0 {
				h.store.SaveConversation(map[string]interface{}{
					"id":      msg.Payload.ConversationID,
					"type":    "dm",
					"members": []interface{}{msg.Payload.SenderID, msg.Payload.RecipientID},
				})
			}
		}

		// Group / multi-member conversation: relay to every member except sender.
		if h.store != nil {
			if members := h.store.GetConversationMembers(msg.Payload.ConversationID); len(members) > 0 {
				for _, m := range members {
					if m == msg.Payload.SenderID {
						continue
					}
					if !h.authorizedRecipient(msg.Payload.SenderID, m, msg.Payload.ConversationID) {
						continue
					}
					if !h.sendToUser(m, "message", msg.Payload) && h.pushHook != nil {
						h.pushHook(m, msg.Payload.SenderID)
					}
				}
				return
			}
		}

		// Legacy single-recipient DM (conversation not yet in the membership table).
		targetID := msg.Payload.RecipientID
		if targetID == "" {
			return
		}
		if !h.authorizedRecipient(msg.Payload.SenderID, targetID, msg.Payload.ConversationID) {
			log.Printf("[WS] dropping %q from %s to unauthorized recipient %s", msg.Type, msg.Payload.SenderID, targetID)
			return
		}
		if !h.sendToUser(targetID, "message", msg.Payload) && h.pushHook != nil {
			h.pushHook(targetID, msg.Payload.SenderID)
		}

	case "contact_request":
		// A contact request is by definition sent to a non-contact, so it is
		// not membership-gated; sender identity is already server-enforced.
		if msg.Payload.ToUserID == "" || msg.Payload.FromUserID == "" {
			return
		}
		// Persist the pending request even when the recipient is currently
		// online: it authorizes the eventual contact_accept (which otherwise
		// fails authorizedRecipient) and lets an offline recipient pick it up
		// on reconnect.
		if h.store != nil {
			h.store.SavePendingContactRequest(msg.Payload.ContactID, map[string]interface{}{
				"id": msg.Payload.ContactID, "fromUserId": msg.Payload.FromUserID,
				"toUserId": msg.Payload.ToUserID, "displayName": msg.Payload.DisplayName,
				"publicKey": msg.Payload.PublicKey, "fingerprint": msg.Payload.Fingerprint,
			})
		}
		h.sendToUser(msg.Payload.ToUserID, "contact_request", msg.Payload)

	case "contact_accept":
		if !h.authorizedRecipient(msg.Payload.FromUserID, msg.Payload.ToUserID, msg.Payload.ConversationID) &&
			!h.hasPendingRequestFrom(msg.Payload.FromUserID, msg.Payload.ToUserID) {
			log.Printf("[WS] dropping contact_accept from %s to unauthorized recipient %s", msg.Payload.FromUserID, msg.Payload.ToUserID)
			return
		}
		// Record the mutual contact relationship server-side so that the two
		// users can exchange DM messages afterwards (authorizedRecipient()
		// consults these keys). Also clear the now-satisfied pending request.
		if h.store != nil {
			h.store.SaveContactPair(msg.Payload.FromUserID, msg.Payload.ToUserID)
			h.store.RemovePendingRequestsBetween(msg.Payload.ToUserID, msg.Payload.FromUserID)
			h.store.SavePendingAccept(msg.Payload.ContactID, map[string]interface{}{
				"id": msg.Payload.ContactID, "fromUserId": msg.Payload.FromUserID,
				"toUserId": msg.Payload.ToUserID, "displayName": msg.Payload.DisplayName,
				"publicKey": msg.Payload.PublicKey, "fingerprint": msg.Payload.Fingerprint,
				"conversationId": msg.Payload.ConversationID,
			})
		}
		h.sendToUser(msg.Payload.ToUserID, "contact_accept", msg.Payload)

	case "contact_decline":
		// A recipient declines a contact request they received. Like accept,
		// identity is server-enforced; the decliner must be the actual
		// recipient of the stored pending request (otherwise anyone could
		// purge someone else's pending requests).
		from, to := msg.Payload.FromUserID, msg.Payload.ToUserID
		if from == "" || to == "" {
			return
		}
		if h.store != nil {
			authorized := false
			for _, r := range h.store.GetPendingContactRequests(from) {
				if ru, _ := r["fromUserId"].(string); ru == to {
					authorized = true
					break
				}
			}
			if authorized {
				// Drop the pending request so it is NOT redelivered to the
				// recipient on their next connect, and tell the original
				// sender their request was declined (instead of lingering in
				// a perpetual "pending" state).
				h.store.RemovePendingContactRequest(msg.Payload.ContactID)
				h.store.RemovePendingRequestsBetween(from, to)
				h.sendToUser(to, "contact_decline", msg.Payload)
			}
		}

	case "user_info_request":
		if !h.authorizedRecipient(msg.Payload.FromUserID, msg.Payload.ToUserID, msg.Payload.ConversationID) {
			log.Printf("[WS] dropping user_info_request from %s to unauthorized recipient %s", msg.Payload.FromUserID, msg.Payload.ToUserID)
			return
		}
		h.sendToUser(msg.Payload.ToUserID, "user_info_request", msg.Payload)

	case "user_info":
		if !h.authorizedRecipient(msg.Payload.FromUserID, msg.Payload.ToUserID, msg.Payload.ConversationID) {
			log.Printf("[WS] dropping user_info from %s to unauthorized recipient %s", msg.Payload.FromUserID, msg.Payload.ToUserID)
			return
		}
		h.sendToUser(msg.Payload.ToUserID, "user_info", msg.Payload)

	case "typing":
		if !h.allowSend(msg.Payload.SenderID) {
			return
		}
		// Relay typing presence to the conversation peer only (never broadcast
		// to every connected client — that would leak who is typing to anyone).
		if msg.Payload.ConversationID == "" || msg.Payload.RecipientID == "" {
			return
		}
		if !h.authorizedRecipient(msg.Payload.SenderID, msg.Payload.RecipientID, msg.Payload.ConversationID) {
			return
		}
		h.sendToUser(msg.Payload.RecipientID, "typing", msg.Payload)

	case "message_read":
		// Read receipt ("Vu"). The reader is the authenticated user
		// (SenderID, overwritten in client.readPump); the receipt is relayed
		// to the ORIGINAL sender (RecipientID) so they learn their message
		// was seen. Gated to conversation members so a reader can only flag
		// receipts for people they actually share a conversation with.
		if msg.Payload.ConversationID == "" || len(msg.Payload.MessageIDs) == 0 {
			return
		}
		if !h.authorizedRecipient(msg.Payload.SenderID, msg.Payload.RecipientID, msg.Payload.ConversationID) {
			log.Printf("[WS] dropping message_read from %s to non-member %s", msg.Payload.SenderID, msg.Payload.RecipientID)
			return
		}
		h.sendToUser(msg.Payload.RecipientID, "message_read", msg.Payload)

	case "message_delete":
		// Unsend ("delete for everyone"): the authenticated sender removes a
		// message for every member of the conversation. Three layers of
		// authorization:
		//   1. sender identity is server-set (client.readPump overwrote SenderID),
		//   2. the deleter must be the message's original author (msgOwners),
		//   3. the deleter must be a conversation member (authorizedRecipient).
		if msg.Payload.ConversationID == "" || msg.Payload.ID == "" {
			return
		}
		// Drop the stored copy so an offline recipient who reconnects later
		// does not receive a message that was already unsent.
		if h.store != nil {
			h.store.DeleteMessage(msg.Payload.ConversationID, msg.Payload.ID)
		}
		owner, ok := h.msgOwners[msg.Payload.ID]
		if !ok || owner != msg.Payload.SenderID {
			log.Printf("[WS] dropping message_delete: sender %s is not the author of %s", msg.Payload.SenderID, msg.Payload.ID)
			return
		}
		if h.store != nil {
			if members := h.store.GetConversationMembers(msg.Payload.ConversationID); len(members) > 0 {
				for _, m := range members {
					if m == msg.Payload.SenderID {
						continue
					}
					if !h.authorizedRecipient(msg.Payload.SenderID, m, msg.Payload.ConversationID) {
						continue
					}
					h.sendToUser(m, "message_delete", msg.Payload)
				}
				return
			}
		}
		// Legacy single-recipient DM (conversation not yet in the membership table).
		targetID := msg.Payload.RecipientID
		if targetID == "" {
			return
		}
		if !h.authorizedRecipient(msg.Payload.SenderID, targetID, msg.Payload.ConversationID) {
			return
		}
		h.sendToUser(targetID, "message_delete", msg.Payload)
	}
}

// authorizedRecipient enforces server-side that `recipient` is either a
// contact of `sender` (either direction) or a member of the conversation.
// Mirrors the REST handlers' conversationHasMember / contact-key checks.
// allowSend enforces a per-user rate limit on message/typing frames so a
// single client cannot flood the hub or its peers. 5 events/sec with a burst
// of 20 — generous for real usage, but stops a naive spammer instantly.
func (h *Hub) allowSend(userID string) bool {
	if userID == "" {
		return false
	}
	h.limitMu.Lock()
	l, ok := h.limiters[userID]
	if !ok {
		l = rate.NewLimiter(rate.Limit(5), 20)
		h.limiters[userID] = l
	}
	h.limitMu.Unlock()
	return l.Allow()
}

// broadcastPresence notifies every currently-online peer that shares a
// conversation with userID of their new presence status, so each peer's
// contact list can show a real online/offline indicator.
func (h *Hub) broadcastPresence(userID, status string) {
	if h.store == nil || userID == "" {
		return
	}
	seen := map[string]bool{}
	for _, conv := range h.store.ListConversations(userID) {
		cid, _ := conv["id"].(string)
		if cid == "" {
			continue
		}
		for _, peer := range h.store.GetConversationMembers(cid) {
			if peer == userID || seen[peer] {
				continue
			}
			seen[peer] = true
			h.sendToUser(peer, "presence", WSPayload{PresenceUserID: userID, PresenceStatus: status})
		}
	}
}

func (h *Hub) authorizedRecipient(sender, recipient, convID string) bool {
	if sender == "" || recipient == "" {
		return false
	}
	if sender == recipient {
		return true
	}
	// Primary: the conversation membership table (groups + DMs created via API).
	if h.store != nil && convID != "" {
		if h.store.IsConversationMember(convID, sender) && h.store.IsConversationMember(convID, recipient) {
			return true
		}
	}
	// Legacy fallback: DM convIDs of the form "conv:<uidA>:<uidB>" and the
	// pre-membership-table contact-key convention.
	if convID != "" && conversationHasMember(convID, sender) && conversationHasMember(convID, recipient) {
		return true
	}
	if h.store != nil {
		if h.store.GetUser("contact:"+sender+":"+recipient) != nil {
			return true
		}
		if h.store.GetUser("contact:"+recipient+":"+sender) != nil {
			return true
		}
	}
	return false
}

// hasPendingRequestFrom reports whether `recipient` has an outstanding contact
// request addressed to `sender` (so the accept frame is legitimate).
func (h *Hub) hasPendingRequestFrom(sender, recipient string) bool {
	if h.store == nil || sender == "" || recipient == "" {
		return false
	}
	for _, req := range h.store.GetPendingContactRequests(sender) {
		if toStr(req["fromUserId"]) == recipient {
			return true
		}
	}
	return false
}

// conversationHasMember mirrors the REST-side check: convIDs follow the
// "conv:<uidA>:<uidB>" naming convention.
func conversationHasMember(convID, userID string) bool {
	if convID == "" || userID == "" {
		return false
	}
	for _, seg := range strings.Split(convID, ":") {
		if seg == userID {
			return true
		}
	}
	return false
}

func (h *Hub) sendToUser(userID string, msgType string, payload WSPayload) bool {
	h.mu.RLock()
	client, ok := h.clients[userID]
	h.mu.RUnlock()
	if ok {
		h.sendToClient(client, msgType, payload)
		return true
	}
	return false
}

func (h *Hub) sendToClient(client *Client, msgType string, payload WSPayload) {
	msg := WSMessage{Type: msgType, Payload: payload}
	data, _ := json.Marshal(msg)
	select {
	case client.send <- data:
	default:
	}
}

func (h *Hub) BroadcastTo(msgType string, payload WSPayload, exclude string) {
	data, _ := json.Marshal(WSMessage{Type: msgType, Payload: payload})
	h.mu.RLock()
	for uid, client := range h.clients {
		if uid != exclude {
			select {
			case client.send <- data:
			default:
			}
		}
	}
	h.mu.RUnlock()
}

func (h *Hub) ServeWs(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WS upgrade error:", err)
		return
	}
	client := &Client{hub: h, conn: conn, send: make(chan []byte, 256), done: make(chan struct{})}
	go client.writePump()
	client.readPump()
}

func now() int64 { return time.Now().UnixMilli() }

func toStr(v interface{}) string {
	if v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}
