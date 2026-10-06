package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"dashboardify/internal/apikey"
	"dashboardify/internal/capture"
)

func TestPublicCaptureAPIRequiresScopedKeyAndPersistsIdempotently(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dashboardify.db")
	keyStore, err := apikey.OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer keyStore.Close()
	_, token, err := keyStore.Create(context.Background(), "iPhone Shortcut", []string{apikey.ScopeCapturesWrite})
	if err != nil {
		t.Fatal(err)
	}
	captureStore, err := capture.OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer captureStore.Close()
	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatal(err)
	}
	service := capture.NewService(captureStore, capture.NewParser(location), func() time.Time {
		return time.Date(2026, time.October, 5, 8, 30, 0, 0, location)
	}, nil)
	handler := NewHandlerForHosts(
		discardLogger(),
		"dashboard.pkrshnan.com",
		"dashboard-api.pkrshnan.com",
		rejectingAuthenticator{},
		keyStore,
		service,
		nil,
		nil,
	)

	unauthorized := publicCaptureRequestForTest(t, "", "shortcut-capture-1", "note: first API capture")
	unauthorizedResponse := httptest.NewRecorder()
	handler.ServeHTTP(unauthorizedResponse, unauthorized)
	if unauthorizedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorizedResponse.Code, http.StatusUnauthorized)
	}

	first := publicCaptureRequestForTest(t, token, "shortcut-capture-1", "note: first API capture")
	firstResponse := httptest.NewRecorder()
	handler.ServeHTTP(firstResponse, first)
	if firstResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d: %s", firstResponse.Code, http.StatusCreated, firstResponse.Body.String())
	}
	var created capture.Record
	if err := json.NewDecoder(firstResponse.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.RawText != "note: first API capture" {
		t.Fatalf("created capture = %#v", created)
	}

	retry := publicCaptureRequestForTest(t, token, "shortcut-capture-1", "note: first API capture")
	retryResponse := httptest.NewRecorder()
	handler.ServeHTTP(retryResponse, retry)
	if retryResponse.Code != http.StatusCreated {
		t.Fatalf("retry status = %d, want %d: %s", retryResponse.Code, http.StatusCreated, retryResponse.Body.String())
	}
	var retried capture.Record
	if err := json.NewDecoder(retryResponse.Body).Decode(&retried); err != nil {
		t.Fatal(err)
	}
	if retried.ID != created.ID {
		t.Fatalf("retry created ID %q, want original %q", retried.ID, created.ID)
	}
}

func TestHostRoutingDoesNotExposeDashboardOrFilesOnAPIHost(t *testing.T) {
	handler := NewHandlerForHosts(
		discardLogger(),
		"dashboard.pkrshnan.com",
		"dashboard-api.pkrshnan.com",
		rejectingAuthenticator{},
		nil,
		nil,
		nil,
		nil,
	)

	for _, target := range []string{
		"https://dashboard-api.pkrshnan.com/",
		"https://dashboard-api.pkrshnan.com/scripts/.env",
		"https://unknown.pkrshnan.com/",
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("GET %s status = %d, want %d", target, response.Code, http.StatusNotFound)
		}
	}

	dashboardResponse := httptest.NewRecorder()
	handler.ServeHTTP(dashboardResponse, httptest.NewRequest(http.MethodGet, "https://dashboard.pkrshnan.com/", nil))
	if dashboardResponse.Code != http.StatusUnauthorized {
		t.Fatalf("dashboard status = %d, want Access authentication rejection", dashboardResponse.Code)
	}
}

func publicCaptureRequestForTest(t *testing.T, token, idempotencyKey, text string) *http.Request {
	t.Helper()
	body, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "https://dashboard-api.pkrshnan.com/v1/captures", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", idempotencyKey)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	return request
}
