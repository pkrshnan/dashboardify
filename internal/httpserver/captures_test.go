package httpserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"dashboardify/internal/capture"
)

func TestCaptureAPIParsesPersistsAndListsRecord(t *testing.T) {
	service := newCaptureService(t)
	handler := NewHandler(discardLogger(), nil, service)

	preview := captureJSONRequest(t, http.MethodPost, "/api/captures/preview", map[string]string{
		"text": "Baseball at 2:30 on Wednesday at the park",
	})
	previewResponse := httptest.NewRecorder()
	handler.ServeHTTP(previewResponse, preview)
	if previewResponse.Code != http.StatusOK {
		t.Fatalf("preview status = %d, want %d: %s", previewResponse.Code, http.StatusOK, previewResponse.Body.String())
	}
	var proposal capture.Proposal
	if err := json.NewDecoder(previewResponse.Body).Decode(&proposal); err != nil {
		t.Fatalf("decode preview: %v", err)
	}
	if proposal.Kind != capture.KindEvent || proposal.Place != "the park" || len(proposal.Highlights) < 3 {
		t.Fatalf("preview = %#v, want highlighted event at the park", proposal)
	}

	create := captureJSONRequest(t, http.MethodPost, "/api/captures", map[string]string{
		"text":            "Baseball at 2:30 on Wednesday at the park",
		"idempotency_key": "browser-generated-request-id",
	})
	createResponse := httptest.NewRecorder()
	handler.ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d: %s", createResponse.Code, http.StatusCreated, createResponse.Body.String())
	}

	listRequest := httptest.NewRequest(http.MethodGet, "http://example.com/api/captures", nil)
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d", listResponse.Code, http.StatusOK)
	}
	var listed struct {
		Captures []capture.Record `json:"captures"`
	}
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listed.Captures) != 1 || listed.Captures[0].Kind != capture.KindEvent || listed.Captures[0].Place != "the park" {
		t.Fatalf("listed captures = %#v", listed.Captures)
	}
}

func TestTodayAndTaskResourceAPIsPersistLifecycle(t *testing.T) {
	service := newCaptureService(t)
	handler := NewHandler(discardLogger(), nil, service)
	create := captureJSONRequest(t, http.MethodPost, "/api/captures", map[string]string{
		"text":            "Remind me to review Dashboardify today at 11 am",
		"idempotency_key": "today-task",
	})
	createResponse := httptest.NewRecorder()
	handler.ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", createResponse.Code, createResponse.Body.String())
	}

	todayResponse := httptest.NewRecorder()
	handler.ServeHTTP(todayResponse, httptest.NewRequest(http.MethodGet, "http://example.com/api/today?date=2026-09-22", nil))
	if todayResponse.Code != http.StatusOK {
		t.Fatalf("Today status = %d: %s", todayResponse.Code, todayResponse.Body.String())
	}
	var today capture.TodayView
	if err := json.NewDecoder(todayResponse.Body).Decode(&today); err != nil {
		t.Fatalf("decode Today response: %v", err)
	}
	if len(today.Tasks) != 1 || today.Tasks[0].Status != "open" {
		t.Fatalf("Today tasks = %#v", today.Tasks)
	}

	update := captureJSONRequest(t, http.MethodPut, "/api/tasks/"+today.Tasks[0].ID, map[string]any{
		"title":   "Review the Dashboardify checkpoint",
		"due_at":  today.Tasks[0].DueAt.Format(time.RFC3339),
		"place":   "home",
		"status":  "completed",
		"all_day": false,
	})
	updateResponse := httptest.NewRecorder()
	handler.ServeHTTP(updateResponse, update)
	if updateResponse.Code != http.StatusOK {
		t.Fatalf("task update status = %d: %s", updateResponse.Code, updateResponse.Body.String())
	}
	var updated capture.TaskRecord
	if err := json.NewDecoder(updateResponse.Body).Decode(&updated); err != nil {
		t.Fatalf("decode task update: %v", err)
	}
	if updated.Status != "completed" || updated.CompletedAt == nil || updated.Title != "Review the Dashboardify checkpoint" {
		t.Fatalf("updated task = %#v", updated)
	}
}

func TestCaptureMutationRejectsCrossOriginRequest(t *testing.T) {
	service := newCaptureService(t)
	handler := NewHandler(discardLogger(), nil, service)
	request := captureJSONRequest(t, http.MethodPost, "/api/captures", map[string]string{
		"text":            "private note",
		"idempotency_key": "cross-origin-request",
	})
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func newCaptureService(t *testing.T) *capture.Service {
	t.Helper()
	store, err := capture.OpenStore(filepath.Join(t.TempDir(), "dashboardify.db"))
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load timezone: %v", err)
	}
	now := time.Date(2026, time.September, 22, 10, 0, 0, 0, location)
	return capture.NewService(store, capture.NewParser(location), func() time.Time { return now })
}

func captureJSONRequest(t *testing.T, method, path string, body any) *http.Request {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	request := httptest.NewRequest(method, "http://example.com"+path, bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set(mutationRequestHeader, "dashboard-ui")
	return request
}
