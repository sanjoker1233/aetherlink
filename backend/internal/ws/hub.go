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
)

type Store interface {
	SavePendingContactRequest(requestID string, data map[string]interface{})
	GetPendingContactRequests(userID string) []map[string]interface{}
	RemovePendingContactRequest(requestID string)
	SavePendingAccept(requestID string, data map[string]interface{})
	GetPendingAccepts(userID string) []map[string]interface{}
	RemovePendingAccept(requestID string)
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

	Token string `json:"token,omitempty"`
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
}

type Hub struct {
	clients    map[string]*Client
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
	store      Store
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) SetStore(s Store) {
	h.store = s
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			old, exists := h.clients[client.userID]
			if exists && old != client {
				close(old.send)
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
			log.Printf("[WS] %s connected (delivered %d requests, %d accepts)", client.userID, deliveredReq, deliveredAccept)

		case client := <-h.unregister:
			h.mu.Lock()
			if cur, ok := h.clients[client.userID]; ok && cur == client {
				delete(h.clients, client.userID)
				close(client.send)
			}
			h.mu.Unlock()
			log.Printf("[WS] %s disconnected", client.userID)

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
		if msg.Payload.ConversationID == "" || msg.Payload.SenderID == "" {
			return
		}
		ack := WSPayload{ID: msg.Payload.ID, Status: "delivered", Timestamp: now()}
		h.sendToUser(msg.Payload.SenderID, "message_ack", ack)

		targetID := msg.Payload.RecipientID
		if targetID == "" {
			return
		}
		h.sendToUser(targetID, "message", msg.Payload)

	case "contact_request":
		if !h.sendToUser(msg.Payload.ToUserID, "contact_request", msg.Payload) && h.store != nil {
			h.store.SavePendingContactRequest(msg.Payload.ContactID, map[string]interface{}{
				"id": msg.Payload.ContactID, "fromUserId": msg.Payload.FromUserID,
				"toUserId": msg.Payload.ToUserID, "displayName": msg.Payload.DisplayName,
				"publicKey": msg.Payload.PublicKey, "fingerprint": msg.Payload.Fingerprint,
			})
		}

	case "contact_accept":
		if !h.sendToUser(msg.Payload.ToUserID, "contact_accept", msg.Payload) && h.store != nil {
			h.store.SavePendingAccept(msg.Payload.ContactID, map[string]interface{}{
				"id": msg.Payload.ContactID, "fromUserId": msg.Payload.FromUserID,
				"toUserId": msg.Payload.ToUserID, "displayName": msg.Payload.DisplayName,
				"publicKey": msg.Payload.PublicKey, "fingerprint": msg.Payload.Fingerprint,
				"conversationId": msg.Payload.ConversationID,
			})
		}

	case "user_info_request":
		h.sendToUser(msg.Payload.ToUserID, "user_info_request", msg.Payload)

	case "user_info":
		h.sendToUser(msg.Payload.ToUserID, "user_info", msg.Payload)
	}
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
	client := &Client{hub: h, conn: conn, send: make(chan []byte, 256)}
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
