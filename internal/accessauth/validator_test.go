package accessauth

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
)

func TestNormalizeTeamDomain(t *testing.T) {
	issuer, err := normalizeTeamDomain("example.cloudflareaccess.com/")
	if err != nil {
		t.Fatalf("normalizeTeamDomain() error = %v", err)
	}
	if issuer != "https://example.cloudflareaccess.com" {
		t.Fatalf("issuer = %q", issuer)
	}

	for _, invalid := range []string{
		"http://example.cloudflareaccess.com",
		"https://example.com",
		"https://example.cloudflareaccess.com/path",
		"https://example.cloudflareaccess.com:8443",
	} {
		if _, err := normalizeTeamDomain(invalid); err == nil {
			t.Errorf("normalizeTeamDomain(%q) accepted invalid origin", invalid)
		}
	}
}

func TestMiddlewareRejectsMissingAssertion(t *testing.T) {
	validator, _, closeServer := testValidator(t)
	defer closeServer()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	response := httptest.NewRecorder()

	validator.Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("protected handler was called")
	})).ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestMiddlewareAcceptsConfiguredSubject(t *testing.T) {
	validator, signingKey, closeServer := testValidator(t)
	defer closeServer()
	rawToken := signedToken(t, signingKey, tokenClaims{
		Issuer:   testIssuer,
		Subject:  "owner-subject",
		Audience: []string{"dashboard-audience"},
		Expiry:   time.Now().Add(time.Hour).Unix(),
		IssuedAt: time.Now().Add(-time.Minute).Unix(),
		Type:     "app",
		Email:    "owner@example.com",
	})
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set(assertionHeader, rawToken)
	response := httptest.NewRecorder()

	validator.Middleware(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		identity, ok := IdentityFromContext(request.Context())
		if !ok || identity.Subject != "owner-subject" || identity.Email != "owner@example.com" {
			t.Fatalf("identity = %#v, ok = %v", identity, ok)
		}
		response.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
}

func TestMiddlewareRejectsWrongAudienceAndSubject(t *testing.T) {
	validator, signingKey, closeServer := testValidator(t)
	defer closeServer()

	tests := []struct {
		name       string
		claims     tokenClaims
		wantStatus int
	}{
		{
			name:       "wrong audience",
			claims:     tokenClaims{Issuer: testIssuer, Subject: "owner-subject", Audience: []string{"other"}, Expiry: time.Now().Add(time.Hour).Unix(), Type: "app"},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "wrong subject",
			claims:     tokenClaims{Issuer: testIssuer, Subject: "other-subject", Audience: []string{"dashboard-audience"}, Expiry: time.Now().Add(time.Hour).Unix(), Type: "app"},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "expired",
			claims:     tokenClaims{Issuer: testIssuer, Subject: "owner-subject", Audience: []string{"dashboard-audience"}, Expiry: time.Now().Add(-time.Minute).Unix(), Type: "app"},
			wantStatus: http.StatusUnauthorized,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.Header.Set(assertionHeader, signedToken(t, signingKey, test.claims))
			response := httptest.NewRecorder()
			validator.Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Fatal("protected handler was called")
			})).ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
		})
	}
}

const testIssuer = "https://issuer.example"

func testValidator(t *testing.T) (*Validator, *rsa.PrivateKey, func()) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	publicKey := jose.JSONWebKey{Key: &privateKey.PublicKey, KeyID: "test-key", Algorithm: string(jose.RS256), Use: "sig"}
	keySet := struct {
		Keys []jose.JSONWebKey `json:"keys"`
	}{Keys: []jose.JSONWebKey{publicKey}}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(keySet)
	}))
	return newValidator(testIssuer, server.URL, "dashboard-audience", "owner-subject"), privateKey, server.Close
}

type tokenClaims struct {
	Issuer   string   `json:"iss"`
	Subject  string   `json:"sub"`
	Audience []string `json:"aud"`
	Expiry   int64    `json:"exp"`
	IssuedAt int64    `json:"iat,omitempty"`
	Type     string   `json:"type"`
	Email    string   `json:"email,omitempty"`
}

func signedToken(t *testing.T, privateKey *rsa.PrivateKey, claims tokenClaims) string {
	t.Helper()
	options := (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "test-key")
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: privateKey}, options)
	if err != nil {
		t.Fatalf("create signer: %v", err)
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	signed, err := signer.Sign(payload)
	if err != nil {
		t.Fatalf("sign claims: %v", err)
	}
	raw, err := signed.CompactSerialize()
	if err != nil {
		t.Fatalf("serialize token: %v", err)
	}
	return raw
}
