package calendar

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCalDAVProviderUsesConditionalAuthenticatedWrites(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		username, password, ok := request.BasicAuth()
		if !ok || username != "owner@example.com" || password != "app-password" {
			http.Error(response, "unauthorized", http.StatusUnauthorized)
			return
		}
		if request.Method != http.MethodPut || request.URL.Path != "/calendars/dashboardify/event.ics" {
			http.Error(response, "unexpected request", http.StatusBadRequest)
			return
		}
		if requests == 1 {
			if request.Header.Get("If-None-Match") != "*" {
				http.Error(response, "missing create precondition", http.StatusBadRequest)
				return
			}
			response.Header().Set("ETag", `"version-1"`)
			response.WriteHeader(http.StatusCreated)
			return
		}
		if request.Header.Get("If-Match") != `"stale"` {
			http.Error(response, "missing update precondition", http.StatusBadRequest)
			return
		}
		response.WriteHeader(http.StatusPreconditionFailed)
	}))
	defer server.Close()

	provider, err := NewCalDAVProvider(Config{
		Endpoint: server.URL + "/", Username: "owner@example.com", Password: "app-password",
	})
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, time.July, 8, 17, 0, 0, 0, time.UTC)
	payload, err := encodeNativeEvent(NativeEvent{
		ID: "event", Title: "Design review", StartAt: &start, Timezone: "UTC", Status: "confirmed",
	}, start)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := provider.Put(context.Background(), "/calendars/dashboardify/event.ics", payload, "")
	if err != nil {
		t.Fatal(err)
	}
	if stored.ETag != `"version-1"` || stored.UID != "event@dashboardify" {
		t.Fatalf("stored object = %+v", stored)
	}
	_, err = provider.Put(context.Background(), "/calendars/dashboardify/event.ics", payload, "stale")
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("stale update error = %v, want conflict", err)
	}
}
