package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"testing"
)

func testKey(t *testing.T) (string, *rsa.PrivateKey) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	der, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatalf("marshal pub: %v", err)
	}
	return base64.StdEncoding.EncodeToString(der), priv
}

// TestRegisterPoPRoundTrip proves the full proof-of-possession flow: the
// server encrypts a nonce with the public key, only the holder of the
// matching private key can decrypt it, and that decrypted value mints a token.
func TestRegisterPoPRoundTrip(t *testing.T) {
	pubB64, priv := testKey(t)

	init, err := RegisterInit("alice", pubB64)
	if err != nil {
		t.Fatalf("RegisterInit: %v", err)
	}
	if init.PendingID == "" || init.EncryptedChallenge == "" {
		t.Fatal("init returned empty pendingId/challenge")
	}

	ct, err := base64.StdEncoding.DecodeString(init.EncryptedChallenge)
	if err != nil {
		t.Fatalf("decode challenge: %v", err)
	}
	plain, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, priv, ct, nil)
	if err != nil {
		t.Fatalf("decrypt challenge: %v", err)
	}
	response := base64.StdEncoding.EncodeToString(plain)

	reg, err := RegisterConfirm(init.PendingID, response)
	if err != nil {
		t.Fatalf("RegisterConfirm: %v", err)
	}
	if reg.Token == "" {
		t.Fatal("empty token")
	}
	if len(reg.Fingerprint) != 32 {
		t.Fatalf("fingerprint should be 32 hex chars, got %q", reg.Fingerprint)
	}
	if reg.Fingerprint != Fingerprint(pubB64) {
		t.Fatal("returned fingerprint mismatch")
	}
}

func TestRegisterPoPRejectsWrongProof(t *testing.T) {
	pubB64, _ := testKey(t)
	init, err := RegisterInit("bob", pubB64)
	if err != nil {
		t.Fatalf("RegisterInit: %v", err)
	}
	if _, err := RegisterConfirm(init.PendingID, "not-the-challenge"); err == nil {
		t.Fatal("expected proof-of-possession failure")
	}
}

func TestRegisterPoPSingleUse(t *testing.T) {
	pubB64, priv := testKey(t)
	init, _ := RegisterInit("carol", pubB64)
	ct, _ := base64.StdEncoding.DecodeString(init.EncryptedChallenge)
	plain, _ := rsa.DecryptOAEP(sha256.New(), rand.Reader, priv, ct, nil)
	response := base64.StdEncoding.EncodeToString(plain)

	if _, err := RegisterConfirm(init.PendingID, response); err != nil {
		t.Fatalf("first confirm: %v", err)
	}
	// Reusing the same pending id must fail (single use).
	if _, err := RegisterConfirm(init.PendingID, response); err == nil {
		t.Fatal("pending registration was not consumed")
	}
}

func TestFingerprintStableAndDistinct(t *testing.T) {
	a, _ := testKey(t)
	b, _ := testKey(t)
	if Fingerprint(a) != Fingerprint(a) {
		t.Fatal("fingerprint not stable")
	}
	if Fingerprint(a) == Fingerprint(b) {
		t.Fatal("distinct keys produced same fingerprint")
	}
	if len(Fingerprint(a)) != 32 {
		t.Fatal("fingerprint not 128-bit (32 hex)")
	}
}
