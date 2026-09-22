package httpserver

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

func TestLivenessIsMinimalAndUncached(t *testing.T) {
	handler := NewHandler(discardLogger(), nil, nil)
	request := httptest.NewRequest(http.MethodGet, "/live", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if got := response.Header().Get("X-Request-ID"); len(got) != 32 {
		t.Fatalf("X-Request-ID length = %d, want 32", len(got))
	}

	var body map[string]string
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode liveness response: %v", err)
	}
	if len(body) != 1 || body["status"] != "ok" {
		t.Fatalf("body = %#v, want only status=ok", body)
	}
}

func TestShellServesReactApplicationUnderStrictCSP(t *testing.T) {
	handler := NewHandler(discardLogger(), nil, nil)
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	body := response.Body.Bytes()
	if !bytes.Contains(body, []byte(`<div id="root"></div>`)) || !bytes.Contains(body, []byte(`type="module"`)) {
		t.Fatal("shell does not bootstrap the React application")
	}
	if bytes.Contains(body, []byte("fonts.googleapis.com")) {
		t.Fatal("shell loads fonts from a third party")
	}
	policy := response.Header().Get("Content-Security-Policy")
	for _, source := range []string{"style-src 'self'", "script-src 'self'", "font-src 'self'"} {
		if !strings.Contains(policy, source) {
			t.Errorf("Content-Security-Policy = %q, missing %q", policy, source)
		}
	}
	if strings.Contains(policy, "'unsafe-inline'") {
		t.Errorf("Content-Security-Policy permits unsafe inline content: %q", policy)
	}
}

func TestReferencedJavaScriptBundleIsServedAsImmutableAsset(t *testing.T) {
	handler := NewHandler(discardLogger(), nil, nil)
	shellResponse := httptest.NewRecorder()
	handler.ServeHTTP(shellResponse, httptest.NewRequest(http.MethodGet, "/", nil))
	match := regexp.MustCompile(`src="(/assets/[^"]+\.js)"`).FindSubmatch(shellResponse.Body.Bytes())
	if len(match) != 2 {
		t.Fatalf("shell does not reference a JavaScript bundle: %s", shellResponse.Body.String())
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, string(match[1]), nil))

	if response.Code != http.StatusOK {
		t.Fatalf("asset status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control = %q, want immutable asset policy", got)
	}
	if got := response.Header().Get("Content-Type"); !strings.Contains(got, "javascript") {
		t.Fatalf("Content-Type = %q, want JavaScript", got)
	}
	if !bytes.Contains(response.Body.Bytes(), []byte("/api/captures/preview")) {
		t.Fatal("JavaScript bundle does not contain the capture interaction")
	}
}

func TestUnknownRouteDoesNotEchoPathOrQuery(t *testing.T) {
	handler := NewHandler(discardLogger(), nil, nil)
	request := httptest.NewRequest(http.MethodGet, "/private-value?secret=do-not-echo", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	if bytes.Contains(response.Body.Bytes(), []byte("private-value")) || bytes.Contains(response.Body.Bytes(), []byte("do-not-echo")) {
		t.Fatalf("404 response echoed request data: %q", response.Body.String())
	}
}

func TestAuthenticationProtectsEveryNonLivenessRoute(t *testing.T) {
	authenticator := rejectingAuthenticator{}
	handler := NewHandler(discardLogger(), authenticator, nil)

	for _, path := range []string{"/", "/unknown"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("GET %s status = %d, want %d", path, response.Code, http.StatusUnauthorized)
		}
	}
}

func TestLivenessBypassesAuthentication(t *testing.T) {
	handler := NewHandler(discardLogger(), rejectingAuthenticator{}, nil)
	request := httptest.NewRequest(http.MethodGet, "/live", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
}

type rejectingAuthenticator struct{}

func (rejectingAuthenticator) Middleware(http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		http.Error(response, "unauthorized", http.StatusUnauthorized)
	})
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
