package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"golang.org/x/time/rate"

	"github.com/cryptmessenger/cryptmessenger-backend/internal/auth"
	"github.com/cryptmessenger/cryptmessenger-backend/internal/db"
	"github.com/cryptmessenger/cryptmessenger-backend/internal/lora"
	"github.com/cryptmessenger/cryptmessenger-backend/internal/mesh"
	"github.com/cryptmessenger/cryptmessenger-backend/internal/meshtastic"
	"github.com/cryptmessenger/cryptmessenger-backend/internal/ratelimit"
	"github.com/cryptmessenger/cryptmessenger-backend/internal/scheduler"
	"github.com/cryptmessenger/cryptmessenger-backend/internal/ws"
)

// Rate-limit policies. Chosen per-endpoint based on the threat, not one-size:
//   - register: unauthed and hits persist() every call, so keep it very tight.
//   - search/messages: authed but still cheap to abuse. 10 rps with a burst of
//     20 lets a real UI feel snappy while blocking enumeration/floods.
// See audit finding H9.
var (
	registerLimiter = ratelimit.New(ratelimit.Config{Rate: rate.Every(20 * time.Second), Burst: 5})
	searchLimiter   = ratelimit.New(ratelimit.Config{Rate: 10, Burst: 20})
	messagesLimiter = ratelimit.New(ratelimit.Config{Rate: 10, Burst: 20})
)

// maxRequestBody caps every JSON POST body. Tokens/pubkeys/messages are all
// well under this; anything larger is a DoS attempt.
const maxRequestBody = 1 << 20 // 1 MiB

func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Header only. The previous ?token= fallback leaked JWTs into
		// access logs, reverse-proxy logs, Referer headers and browser history.
		token := r.Header.Get("X-Crypt-Token")
		if token == "" {
			http.Error(w, `{"error":"missing token"}`, http.StatusUnauthorized)
			return
		}
		userID, err := auth.ValidateToken(token)
		if err != nil || userID == "" {
			http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
			return
		}
		r.Header.Set("X-User-ID", userID)
		// Cap body size for every authed handler.
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
		next.ServeHTTP(w, r)
	})
}

var (
	registeredUsers   = make(map[string]map[string]string)
	registeredUsersMu sync.RWMutex
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "9090"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if err := auth.SetJWTSecret(jwtSecret); err != nil {
		log.Fatalf("FATAL: %v. Set JWT_SECRET to a random 32+ byte string (e.g. `openssl rand -hex 32`).", err)
	}

	// DATA_DIR is where the JSON store lives. Default is ./data under the
	// server's CWD — anywhere but /tmp, which is world-readable and wipes on
	// reboot. On first startup, db.NewStore will migrate any legacy
	// /tmp/cryptmessenger-db.json into this new location with 0600 perms.
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "./data"
	}
	dbPath := dataDir + "/cryptmessenger-db.json"
	store := db.NewStore(dbPath)

	hub := ws.NewHub()
	hub.SetStore(store)
	go hub.Run()

	meshSim := mesh.NewSimulator()
	meshUpdates := meshSim.Start()
	defer meshSim.Stop()

	go func() {
		for range meshUpdates {
			hub.BroadcastTo("network_update", ws.WSPayload{}, "")
		}
	}()

	loraBridge := lora.NewBridge(lora.Config{
		Region: "EU868", Frequency: 868.1, SpreadingFactor: 12,
		Bandwidth: 125, TXPower: 14, Enabled: false,
	})

	meshtasticBridge := meshtastic.NewBridge(meshtastic.Config{
		Enabled: false, ChannelName: "CRYPTMessenger", ModemPreset: "LONG_FAST",
	})

	sched := scheduler.NewScheduler()
	go func() {
		for msgs := range sched.Start(2 * time.Second) {
			for _, msg := range msgs {
				log.Printf("[Scheduler] Routing %s via %v", msg.ID, msg.Routes)
			}
		}
	}()

	// CORS: explicit allowlist from ALLOWED_ORIGINS (comma-separated).
	// Falls back to a safe localhost dev default. NEVER wildcard on an authed API.
	allowedOrigins := parseAllowedOrigins(os.Getenv("ALLOWED_ORIGINS"))
	log.Printf("CORS allowed origins: %v", allowedOrigins)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Crypt-Token"},
		ExposedHeaders:   []string{"Link"},
		MaxAge:           300,
	}))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok","service":"cryptmessenger","version":"0.1.0"}`))
	})

	r.With(registerLimiter.Middleware).Post("/api/auth/register", func(w http.ResponseWriter, r *http.Request) {
		// Register is unauthenticated so it doesn't hit authMiddleware's MaxBytesReader.
		// Cap it explicitly to stop trivial POST-a-huge-body DoS on an anonymous endpoint.
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
		var body struct {
			DisplayName string `json:"displayName"`
			PublicKey   string `json:"publicKey"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
			return
		}
		resp, _ := auth.RegisterHandler(body.DisplayName, body.PublicKey)
		if resp != nil {
			userData := map[string]string{
				"userId":      resp.UserID,
				"displayName": body.DisplayName,
				"publicKey":   body.PublicKey,
				"fingerprint": resp.Fingerprint,
			}
			registeredUsersMu.Lock()
			registeredUsers[resp.Fingerprint] = userData
			registeredUsersMu.Unlock()
			store.SaveUser("reg:"+resp.Fingerprint, map[string]interface{}{
				"userId": resp.UserID, "displayName": body.DisplayName,
				"publicKey": body.PublicKey, "fingerprint": resp.Fingerprint,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	r.Group(func(r chi.Router) {
		r.Use(authMiddleware)

		r.Get("/api/users/lookup", func(w http.ResponseWriter, r *http.Request) {
			fp := r.URL.Query().Get("fp")
			w.Header().Set("Content-Type", "application/json")
			if fp == "" {
				json.NewEncoder(w).Encode([]map[string]string{})
				return
			}
			registeredUsersMu.RLock()
			user, ok := registeredUsers[fp]
			registeredUsersMu.RUnlock()
			if ok {
				json.NewEncoder(w).Encode([]map[string]string{user})
			} else {
				json.NewEncoder(w).Encode([]map[string]string{})
			}
		})

		r.With(searchLimiter.Middleware).Get("/api/users/search", func(w http.ResponseWriter, r *http.Request) {
			q := r.URL.Query().Get("q")
			w.Header().Set("Content-Type", "application/json")
			if q == "" {
				json.NewEncoder(w).Encode([]map[string]string{})
				return
			}
			results := store.SearchUsers(q)
			if results == nil {
				json.NewEncoder(w).Encode([]map[string]string{})
				return
			}
			out := make([]map[string]string, 0, len(results))
			for _, v := range results {
				out = append(out, map[string]string{
					"userId":      toString(v["userId"]),
					"displayName": toString(v["displayName"]),
					"publicKey":   toString(v["publicKey"]),
					"fingerprint": toString(v["fingerprint"]),
				})
			}
			json.NewEncoder(w).Encode(out)
		})

		r.Get("/api/messages/{convID}", func(w http.ResponseWriter, r *http.Request) {
			// Authorization: only members of the conversation may read it.
			// Convention: conversation IDs are of the form "conv:<uidA>:<uidB>"
			// (sorted). We accept any conv ID that literally contains the caller's
			// user ID as a segment. This is a minimal check that closes the trivial
			// "GET any convID and read everything" IDOR; a proper membership table
			// should replace it. See audit finding #5.
			userID := r.Header.Get("X-User-ID")
			convID := chi.URLParam(r, "convID")
			if !conversationHasMember(convID, userID) {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}
			msgs := store.GetMessages(convID)
			if msgs == nil {
				msgs = []map[string]interface{}{}
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msgs)
		})

		r.With(messagesLimiter.Middleware).Post("/api/messages", func(w http.ResponseWriter, r *http.Request) {
			userID := r.Header.Get("X-User-ID")
			var body struct {
				ConversationID string `json:"conversationId"`
				// SenderID intentionally NOT read from the client — we set it from
				// the authenticated user. Trusting body.SenderID was the IDOR that
				// let any user post as any other. See audit finding #5.
				Content        string `json:"content"`
				Encrypted      bool   `json:"encrypted"`
				EncryptedKey   string `json:"encryptedKey,omitempty"`
				IV             string `json:"iv,omitempty"`
				Timestamp      int64  `json:"timestamp,omitempty"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
				return
			}
			if body.ConversationID == "" {
				http.Error(w, `{"error":"missing required fields"}`, http.StatusBadRequest)
				return
			}
			if !conversationHasMember(body.ConversationID, userID) {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}
			msg := map[string]interface{}{
				"id":             auth.GenerateID(),
				"conversationId": body.ConversationID,
				"senderId":       userID, // authoritative
				"content":        body.Content,
				"encrypted":      body.Encrypted,
				"encryptedKey":   body.EncryptedKey,
				"iv":             body.IV,
				"timestamp":      body.Timestamp,
				"status":         "sent",
			}
			if msg["timestamp"].(int64) == 0 {
				msg["timestamp"] = time.Now().UnixMilli()
			}
			store.SaveMessage(body.ConversationID, msg)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		})

		r.Post("/api/contacts", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				UserID      string `json:"userId"`
				ContactID   string `json:"contactId"`
				DisplayName string `json:"displayName"`
				PublicKey   string `json:"publicKey"`
				Fingerprint string `json:"fingerprint"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
				return
			}
			contact := map[string]interface{}{
				"id":             auth.GenerateID(),
				"userId":         body.ContactID,
				"displayName":    body.DisplayName,
				"publicKey":      body.PublicKey,
				"fingerprint":    body.Fingerprint,
				"status":         "offline",
				"createdAt":      time.Now().UnixMilli(),
			}
			store.SaveUser("contact:"+body.UserID+":"+body.ContactID, contact)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(contact)
		})

		r.Get("/api/contacts/{userID}", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]interface{}{})
		})

		// Network / bridge status — auth-required. Anonymous callers previously
		// leaked device IDs, node lists and GPS coords (audit finding #16).
		r.Get("/api/network/status", func(w http.ResponseWriter, r *http.Request) {
			net := meshSim.GetNetwork()
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(net)
		})

		r.Get("/api/lora/status", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(loraBridge.GetStatus())
		})

		r.Get("/api/lora/devices", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(loraBridge.GetDevices())
		})

		r.Get("/api/meshtastic/status", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(meshtasticBridge.GetStatus())
		})

		r.Get("/api/meshtastic/nodes", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(meshtasticBridge.GetNodes())
		})
	})

	r.HandleFunc("/ws", hub.ServeWs)

	// Load existing registered users from store into memory
	for k, v := range store.GetAllUsers() {
		if len(k) > 4 && k[:4] == "reg:" {
			fp, _ := v["fingerprint"].(string)
			if fp != "" {
				registeredUsersMu.Lock()
				registeredUsers[fp] = map[string]string{
					"userId":      toString(v["userId"]),
					"displayName": toString(v["displayName"]),
					"publicKey":   toString(v["publicKey"]),
					"fingerprint": fp,
				}
				registeredUsersMu.Unlock()
			}
		}
	}
	log.Printf("Loaded %d registered users from store", len(registeredUsers))

	store.SaveUser("admin", map[string]interface{}{"name": "Admin", "created": "2024-01-01"})

	// Bind localhost by default so accidental deploy doesn't expose plaintext HTTP
	// on 0.0.0.0. Operators put a TLS-terminating proxy in front and/or set BIND=":9090".
	bind := os.Getenv("BIND")
	if bind == "" {
		bind = "127.0.0.1:" + port
	}

	log.Printf("CRYPTMessenger on %s", bind)
	log.Printf("  Frontend: http://localhost:3000")
	log.Printf("  Health:   http://%s/health", bind)
	log.Printf("  WS:       ws://%s/ws (put TLS in front for prod)", bind)

	srv := &http.Server{
		Addr:              bind,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

// parseAllowedOrigins parses a comma-separated list into a normalized slice.
// Wildcards are refused — a wildcard on an authed API means any origin can
// read cross-origin responses once it has a token.
func parseAllowedOrigins(raw string) []string {
	if raw == "" {
		return []string{"http://localhost:3000", "http://127.0.0.1:3000"}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" || p == "*" {
			continue
		}
		out = append(out, p)
	}
	if len(out) == 0 {
		log.Fatal("ALLOWED_ORIGINS set but no valid origins parsed (wildcards refused)")
	}
	return out
}

// conversationHasMember does a minimal membership check based on the naming
// convention "conv:<uidA>:<uidB>" (or any convID containing the user ID as a
// segment). Replace with a real membership table once the schema supports it.
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

func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}
