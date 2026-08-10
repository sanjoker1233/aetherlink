package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type RegisterResponse struct {
	UserID      string `json:"userId"`
	Token       string `json:"token"`
	Fingerprint string `json:"fingerprint"`
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

func RegisterHandler(displayName string, publicKey string) (*RegisterResponse, error) {
	userID := uuid.New().String()

	hash := sha256.Sum256([]byte(publicKey))
	fingerprint := hex.EncodeToString(hash[:4])[:8]

	claims := jwt.MapClaims{
		"sub":  userID,
		"name": displayName,
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
		Fingerprint: fingerprint,
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
