package ws

import (
	"encoding/json"
	"time"

	"github.com/cryptmessenger/cryptmessenger-backend/internal/auth"
	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 65536
	// authHandshakeWait bounds how long a freshly-connected client has to send
	// the "auth" frame. Without this, half-open sockets tie up FDs indefinitely
	// (audit finding M4).
	authHandshakeWait = 10 * time.Second
)

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	// Short deadline until the client authenticates, then extend to pongWait.
	c.conn.SetReadDeadline(time.Now().Add(authHandshakeWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "auth":
			userID, err := auth.ValidateToken(msg.Payload.Token)
			if err != nil || userID == "" {
				c.send <- mustMarshal(WSMessage{Type: "auth_error", Payload: WSPayload{Content: "invalid_token"}})
				return
			}
			c.userID = userID
			// Auth succeeded — extend the read deadline to the normal pong window.
			c.conn.SetReadDeadline(time.Now().Add(pongWait))
			c.hub.register <- c

		case "ping":
			c.send <- mustMarshal(WSMessage{Type: "pong",
				Payload: WSPayload{Timestamp: time.Now().UnixMilli()}})

		default:
			if c.userID == "" || c.userID == "anonymous" {
				continue
			}
			// SECURITY: overwrite every client-supplied identity field with the
			// authenticated userID before broadcasting. Previously the hub
			// dispatched on msg.Payload.SenderID / FromUserID verbatim, which
			// let any authenticated user impersonate any other user over WS.
			// See audit findings C5 / H3.
			msg.Payload.SenderID = c.userID
			msg.Payload.FromUserID = c.userID
			// Never let the client set X-User-ID via the token field on non-auth frames.
			msg.Payload.Token = ""

			sanitized, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			c.hub.broadcast <- sanitized
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			w, _ := c.conn.NextWriter(websocket.TextMessage)
			if w != nil {
				w.Write(msg)
				for i := 0; i < len(c.send); i++ {
					w.Write([]byte("\n"))
					w.Write(<-c.send)
				}
				w.Close()
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			c.conn.WriteMessage(websocket.PingMessage, nil)
		}
	}
}

func mustMarshal(v any) []byte {
	data, _ := json.Marshal(v)
	return data
}
