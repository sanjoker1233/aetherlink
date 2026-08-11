package push

import (
	"encoding/json"
	"log"

	wp "github.com/SherClockHolmes/webpush-go"
)

// Service sends WebPush notifications. The relay is E2E-encrypted, so the
// server only ever forwards a generic "you have a new message" ping — never
// plaintext. That is intentional: the backend must not be able to read message
// bodies.
type Service struct {
	vapidPrivate string
	vapidPublic  string
	subject      string
}

// New builds a push service. If VAPID env vars are provided they are used
// (stable across restarts). Otherwise an ephemeral keypair is generated and a
// warning is logged — subscriptions created against it stop working on restart.
func New(subject, pubEnv, privEnv string) *Service {
	s := &Service{subject: subject}
	if privEnv != "" && pubEnv != "" {
		s.vapidPrivate = privEnv
		s.vapidPublic = pubEnv
		return s
	}
	priv, pub, err := wp.GenerateVAPIDKeys()
	if err != nil {
		log.Printf("[push] failed to generate VAPID keys: %v", err)
		return s
	}
	s.vapidPrivate = priv
	s.vapidPublic = pub
	log.Printf("[push] WARNING: VAPID keys auto-generated (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set). Push subscriptions are ephemeral and break on restart — set them in production.")
	return s
}

// PublicKey returns the VAPID public key the frontend needs to subscribe.
func (s *Service) PublicKey() string { return s.vapidPublic }

// Send delivers a notification to a single stored subscription. A missing or
// incomplete subscription is silently skipped (no push for that device).
func (s *Service) Send(sub map[string]interface{}, title, body string) error {
	if s.vapidPrivate == "" {
		return nil
	}
	endpoint, _ := sub["endpoint"].(string)
	keys, _ := sub["keys"].(map[string]interface{})
	p256dh, _ := keys["p256dh"].(string)
	auth, _ := keys["auth"].(string)
	if endpoint == "" || p256dh == "" || auth == "" {
		return nil
	}
	subscription := &wp.Subscription{
		Endpoint: endpoint,
		Keys:     wp.Keys{P256dh: p256dh, Auth: auth},
	}
	payload, err := json.Marshal(map[string]string{"title": title, "body": body})
	if err != nil {
		return err
	}
	resp, err := wp.SendNotification(payload, subscription, &wp.Options{
		Subscriber:      s.subject,
		VAPIDPrivateKey: s.vapidPrivate,
		TTL:             60,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("[push] delivery to %s returned HTTP %d", endpoint, resp.StatusCode)
	}
	return nil
}
