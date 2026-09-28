package calendar

import (
	"context"
	"errors"
	"fmt"
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

func TestCalDAVProviderIgnoresCollectionLevelMissingCalendarData(t *testing.T) {
	const eventPayload = "BEGIN:VCALENDAR\r\n" +
		"VERSION:2.0\r\n" +
		"PRODID:-//Dashboardify Test//EN\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:event@dashboardify\r\n" +
		"DTSTAMP:20260708T170000Z\r\n" +
		"DTSTART:20260708T170000Z\r\n" +
		"DTEND:20260708T180000Z\r\n" +
		"SUMMARY:Design review\r\n" +
		"END:VEVENT\r\n" +
		"END:VCALENDAR\r\n"
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		if request.Method != "REPORT" || request.Header.Get("Depth") != "1" {
			http.Error(response, "unexpected calendar query", http.StatusBadRequest)
			return
		}
		objectResponse := ""
		if requests == 1 {
			objectResponse = fmt.Sprintf(`
  <D:response>
    <D:href>/calendars/dashboardify/event.ics</D:href>
    <D:propstat><D:prop>
      <D:getetag>&quot;event-v1&quot;</D:getetag>
      <C:calendar-data><![CDATA[%s]]></C:calendar-data>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>`, eventPayload)
		}
		body := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/calendars/dashboardify/</D:href>
    <D:propstat><D:prop><C:calendar-data/></D:prop>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>
  </D:response>%s
</D:multistatus>`, objectResponse)
		response.Header().Set("Content-Type", "application/xml")
		response.WriteHeader(http.StatusMultiStatus)
		_, _ = response.Write([]byte(body))
	}))
	defer server.Close()

	provider, err := NewCalDAVProvider(Config{
		Endpoint: server.URL + "/", Username: "owner@example.com", Password: "app-password",
	})
	if err != nil {
		t.Fatal(err)
	}
	objects, err := provider.List(context.Background(), "/calendars/dashboardify/")
	if err != nil {
		t.Fatal(err)
	}
	if len(objects) != 1 || objects[0].UID != "event@dashboardify" || objects[0].ETag != `"event-v1"` {
		t.Fatalf("objects = %+v", objects)
	}
	objects, err = provider.List(context.Background(), "/calendars/dashboardify/")
	if err != nil {
		t.Fatal(err)
	}
	if len(objects) != 0 {
		t.Fatalf("empty calendar objects = %+v", objects)
	}
}
