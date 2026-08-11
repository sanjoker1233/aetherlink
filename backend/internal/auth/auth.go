package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type RegisterResponse struct {
	UserID      string `json:"userId"`
	Token       string `json:"token"`
	Fingerprint string `json:"fingerprint"`
	// DisplayName / PublicKey are echoed back so the HTTP layer can persist the
	// now-verified identity without re-deriving it from the (already deleted)
	// pending registration. Both are public, non-sensitive.
	DisplayName string `json:"displayName"`
	PublicKey   string `json:"publicKey"`
}

// RegisterInitResponse carries the server-encrypted proof-of-possession
// challenge. The client must decrypt it with the PRIVATE key matching the
// public key it just submitted and return the plaintext to RegisterConfirm.
// This proves the registrant actually holds the private key — without it,
// anyone could register a public key they don't control and impersonate that
// identity. See audit finding on register PoP.
type RegisterInitResponse struct {
	PendingID          string `json:"pendingId"`
	EncryptedChallenge string `json:"encryptedChallenge"`
}

type pendingReg struct {
	displayName  string
	publicKey    string
	challengeB64 string
	expires      time.Time
}

var (
	regMu       sync.Mutex
	pendingRegs = map[string]*pendingReg{}
)

func init() {
	// Reap expired pending registrations so the map can't grow unbounded.
	go func() {
		for range time.Tick(time.Minute) {
			regMu.Lock()
			now := time.Now()
			for id, p := range pendingRegs {
				if now.After(p.expires) {
					delete(pendingRegs, id)
				}
			}
			regMu.Unlock()
		}
	}()
}

var jwtSecret []byte

// SetJWTSecret installs the HMAC signing key. Returns an error if the secret
// is empty or obviously too weak. The caller (main) MUST refuse to start on error
// — a shared/hardcoded fallback would let anyone forge tokens.
func SetJWTSecret(secret string) error {
	if secret == "" {
		return errors.New("JWT_SECRET is required and must not be empty")
	}
	if len(secret) < 32 {
		return errors.New("JWT_SECRET must be at least 32 bytes")
	}
	jwtSecret = []byte(secret)
	return nil
}

// ValidatePublicKey parses an SPKI/PKIX base64 RSA public key and returns its
// modulus size in bits. Rejects anything that isn't RSA or is weaker than 2048.
func ValidatePublicKey(publicKeyB64 string) (int, error) {
	der, err := base64.StdEncoding.DecodeString(publicKeyB64)
	if err != nil {
		return 0, errors.New("public key is not valid base64")
	}
	pubIF, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		return 0, errors.New("public key is not a valid SPKI key")
	}
	rsaPub, ok := pubIF.(*rsa.PublicKey)
	if !ok {
		return 0, errors.New("public key must be RSA")
	}
	if rsaPub.N.BitLen() < 2048 {
		return 0, errors.New("public key must be at least 2048 bits")
	}
	return rsaPub.N.BitLen(), nil
}

// verifiedIdentities is the post-proof set of identities that have completed
// registration (or login). Keyed by fingerprint so login can map a presented
// public key back to its server-side userID without re-minting one. Populated
// by RecordVerifiedIdentity, which main calls on register-confirm and at
// startup from the persisted store.
var (
	viMu               sync.Mutex
	verifiedIdentities = map[string]*verifiedIdentity{}
)

type verifiedIdentity struct {
	userID      string
	displayName string
	publicKey   string
}

// RecordVerifiedIdentity makes a completed identity discoverable for login by
// its public key. Idempotent.
func RecordVerifiedIdentity(publicKey, userID, displayName string) {
	viMu.Lock()
	defer viMu.Unlock()
	verifiedIdentities[Fingerprint(publicKey)] = &verifiedIdentity{
		userID:      userID,
		displayName: displayName,
		publicKey:   publicKey,
	}
}

// issueToken mints a 24h HS256 token for an already-verified identity. Shared
// by register (new identity) and login (existing identity).
func issueToken(userID, displayName string) (string, error) {
	claims := jwt.MapClaims{
		"sub":  userID,
		"name": displayName,
		"exp":  time.Now().Add(24 * time.Hour).Unix(),
		"iat":  time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// Fingerprint is the SHA-256 of the base64 public key, truncated to 128 bits
// (16 bytes). 128 bits is far above the collision threshold and matches the
// client-side computation so user lookups line up.
func Fingerprint(publicKey string) string {
	hash := sha256.Sum256([]byte(publicKey))
	return hex.EncodeToString(hash[:16])
}

// RegisterInit validates the submitted public key, mints a random 32-byte
// challenge, encrypts it under the public key (RSA-OAEP / SHA-256) and stores a
// short-lived pending registration. The client can only complete it by
// decrypting the challenge with the matching private key.
func RegisterInit(displayName, publicKey string) (*RegisterInitResponse, error) {
	regMu.Lock()
	defer regMu.Unlock()
	// Reject a second in-flight registration for the same public key.
	for _, p := range pendingRegs {
		if p.publicKey == publicKey {
			return nil, errors.New("registration already in progress for this key")
		}
	}

	der, err := base64.StdEncoding.DecodeString(publicKey)
	if err != nil {
		return nil, errors.New("public key is not valid base64")
	}
	pubIF, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		return nil, errors.New("public key is not a valid SPKI key")
	}
	rsaPub, ok := pubIF.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("public key must be RSA")
	}

	challenge := make([]byte, 32)
	if _, err := rand.Read(challenge); err != nil {
		return nil, errors.New("could not generate challenge")
	}
	ct, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, rsaPub, challenge, nil)
	if err != nil {
		return nil, errors.New("could not encrypt challenge")
	}

	id := uuid.New().String()
	pendingRegs[id] = &pendingReg{
		displayName:  displayName,
		publicKey:    publicKey,
		challengeB64: base64.StdEncoding.EncodeToString(challenge),
		expires:      time.Now().Add(10 * time.Minute),
	}
	return &RegisterInitResponse{
		PendingID:          id,
		EncryptedChallenge: base64.StdEncoding.EncodeToString(ct),
	}, nil
}

// RegisterConfirm verifies the returned proof equals the original challenge,
// consumes the pending registration (single use), and issues the identity
// token. Any mismatch means the caller could not decrypt the challenge and
// therefore does not possess the private key.
func RegisterConfirm(pendingID, responseB64 string) (*RegisterResponse, error) {
	regMu.Lock()
	p, ok := pendingRegs[pendingID]
	if !ok {
		regMu.Unlock()
		return nil, errors.New("unknown or expired registration")
	}
	if time.Now().After(p.expires) {
		delete(pendingRegs, pendingID)
		regMu.Unlock()
		return nil, errors.New("registration expired")
	}
	// Single use: delete before we do any work.
	delete(pendingRegs, pendingID)
	regMu.Unlock()

	if responseB64 != p.challengeB64 {
		return nil, errors.New("proof of possession failed")
	}

	userID := uuid.New().String()
	fp := Fingerprint(p.publicKey)

	claims := jwt.MapClaims{
		"sub":  userID,
		"name": p.displayName,
		"exp":  time.Now().Add(24 * time.Hour).Unix(),
		"iat":  time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return nil, err
	}

	return &RegisterResponse{
		UserID:      userID,
		Token:       tokenString,
		Fingerprint: fp,
		DisplayName: p.displayName,
		PublicKey:   p.publicKey,
	}, nil
}

// LoginInit starts a proof-of-possession login for an EXISTING identity. It
// behaves like RegisterInit (encrypts a fresh challenge under the public key)
// but only succeeds if that public key has already completed registration.
// This lets a user recover their identity on a new device without ever
// exporting the private key in the clear — they only prove possession of it.
func LoginInit(publicKey string) (*RegisterInitResponse, error) {
	if _, err := ValidatePublicKey(publicKey); err != nil {
		return nil, err
	}
	viMu.Lock()
	_, ok := verifiedIdentities[Fingerprint(publicKey)]
	viMu.Unlock()
	if !ok {
		return nil, errors.New("no account found for this public key")
	}

	regMu.Lock()
	defer regMu.Unlock()
	// Reject a second in-flight login for the same public key.
	for _, p := range pendingRegs {
		if p.publicKey == publicKey {
			return nil, errors.New("login already in progress for this key")
		}
	}

	der, err := base64.StdEncoding.DecodeString(publicKey)
	if err != nil {
		return nil, errors.New("public key is not valid base64")
	}
	pubIF, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		return nil, errors.New("public key is not a valid SPKI key")
	}
	rsaPub, ok := pubIF.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("public key must be RSA")
	}

	challenge := make([]byte, 32)
	if _, err := rand.Read(challenge); err != nil {
		return nil, errors.New("could not generate challenge")
	}
	ct, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, rsaPub, challenge, nil)
	if err != nil {
		return nil, errors.New("could not encrypt challenge")
	}

	id := uuid.New().String()
	pendingRegs[id] = &pendingReg{
		publicKey:    publicKey,
		challengeB64: base64.StdEncoding.EncodeToString(challenge),
		expires:      time.Now().Add(10 * time.Minute),
	}
	return &RegisterInitResponse{
		PendingID:          id,
		EncryptedChallenge: base64.StdEncoding.EncodeToString(ct),
	}, nil
}

// LoginConfirm verifies the proof for an in-flight login and issues a token
// for the EXISTING userID bound to that public key. It does NOT create a new
// identity (that's RegisterConfirm's job) and does NOT persist anything.
func LoginConfirm(pendingID, responseB64 string) (*RegisterResponse, error) {
	regMu.Lock()
	p, ok := pendingRegs[pendingID]
	if !ok {
		regMu.Unlock()
		return nil, errors.New("unknown or expired login")
	}
	if time.Now().After(p.expires) {
		delete(pendingRegs, pendingID)
		regMu.Unlock()
		return nil, errors.New("login expired")
	}
	delete(pendingRegs, pendingID)
	regMu.Unlock()

	if responseB64 != p.challengeB64 {
		return nil, errors.New("proof of possession failed")
	}

	fp := Fingerprint(p.publicKey)
	viMu.Lock()
	idrec, ok := verifiedIdentities[fp]
	viMu.Unlock()
	if !ok {
		return nil, errors.New("account no longer exists")
	}

	token, err := issueToken(idrec.userID, idrec.displayName)
	if err != nil {
		return nil, err
	}

	return &RegisterResponse{
		UserID:      idrec.userID,
		Token:       token,
		Fingerprint: fp,
		DisplayName: idrec.displayName,
		PublicKey:   p.publicKey,
	}, nil
}

func ValidateToken(tokenString string) (string, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		// Pin to HS256 exactly. Accepting the whole HMAC family is fine today
		// but leaves a foot-gun if the code ever adds RS/ES keys.
		if token.Method != jwt.SigningMethodHS256 {
			return nil, jwt.ErrSignatureInvalid
		}
		return jwtSecret, nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return "", err
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return "", jwt.ErrSignatureInvalid
	}
	sub, _ := claims["sub"].(string)
	return sub, nil
}

func GenerateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
