package httpserver

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"dashboardify/internal/calendar"
)

type calendarAPI struct {
	service *calendar.Service
	logger  *slog.Logger
}

type conflictResolutionRequest struct {
	Strategy string `json:"strategy"`
}

type eventUpdateRequest struct {
	Title     string `json:"title"`
	StartAt   string `json:"start_at,omitempty"`
	EndAt     string `json:"end_at,omitempty"`
	StartDate string `json:"start_date,omitempty"`
	EndDate   string `json:"end_date,omitempty"`
	AllDay    bool   `json:"all_day"`
	Timezone  string `json:"timezone"`
	Place     string `json:"place,omitempty"`
	Status    string `json:"status"`
}

func (api calendarAPI) status(response http.ResponseWriter, request *http.Request) {
	status, err := api.service.Status(request.Context())
	if err != nil {
		api.writeFailure(response, request, "calendar.status_failed", err)
		return
	}
	writeJSON(response, http.StatusOK, status)
}

func (api calendarAPI) discover(response http.ResponseWriter, request *http.Request) {
	if !acceptSameOriginJSON(response, request) {
		return
	}
	discovery, err := api.service.Discover(request.Context())
	if err != nil {
		api.writeFailure(response, request, "calendar.discovery_failed", err)
		return
	}
	writeJSON(response, http.StatusOK, discovery)
}

func (api calendarAPI) sync(response http.ResponseWriter, request *http.Request) {
	if !acceptSameOriginJSON(response, request) {
		return
	}
	summary, err := api.service.Sync(request.Context())
	if err != nil {
		api.writeFailure(response, request, "calendar.sync_failed", err)
		return
	}
	writeJSON(response, http.StatusOK, summary)
}

func (api calendarAPI) conflicts(response http.ResponseWriter, request *http.Request) {
	conflicts, err := api.service.Conflicts(request.Context())
	if err != nil {
		api.writeFailure(response, request, "calendar.conflicts_failed", err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"conflicts": conflicts})
}

func (api calendarAPI) resolveConflict(response http.ResponseWriter, request *http.Request) {
	if !acceptSameOriginJSON(response, request) {
		return
	}
	var input conflictResolutionRequest
	if !decodeJSON(response, request, &input) {
		return
	}
	if input.Strategy != "local" && input.Strategy != "remote" {
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": "strategy must be local or remote"})
		return
	}
	if err := api.service.ResolveConflict(request.Context(), request.PathValue("id"), input.Strategy); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(response, http.StatusNotFound, map[string]string{"error": "calendar conflict not found"})
			return
		}
		api.writeFailure(response, request, "calendar.conflict_resolution_failed", err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (api calendarAPI) updateEvent(response http.ResponseWriter, request *http.Request) {
	if !acceptSameOriginJSON(response, request) {
		return
	}
	var input eventUpdateRequest
	if !decodeJSON(response, request, &input) {
		return
	}
	event, err := api.service.Event(request.Context(), request.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "event not found"})
		return
	}
	if err != nil {
		api.writeFailure(response, request, "calendar.event_read_failed", err)
		return
	}
	event.Title = input.Title
	event.StartDate = input.StartDate
	event.EndDate = input.EndDate
	event.AllDay = input.AllDay
	event.Timezone = input.Timezone
	event.Place = input.Place
	event.Status = input.Status
	if input.StartAt == "" {
		event.StartAt = nil
	} else {
		parsed, err := time.Parse(time.RFC3339, input.StartAt)
		if err != nil {
			writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": "start_at must use RFC 3339"})
			return
		}
		event.StartAt = &parsed
	}
	if input.EndAt == "" {
		event.EndAt = nil
	} else {
		parsed, err := time.Parse(time.RFC3339, input.EndAt)
		if err != nil {
			writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": "end_at must use RFC 3339"})
			return
		}
		event.EndAt = &parsed
	}
	updated, err := api.service.UpdateEvent(request.Context(), event)
	if err != nil {
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(response, http.StatusOK, updated)
}

func (api calendarAPI) writeFailure(response http.ResponseWriter, request *http.Request, event string, err error) {
	api.logger.ErrorContext(request.Context(), event,
		"request_id", request.Context().Value(requestIDKey),
		"error", err,
	)
	writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "calendar service unavailable"})
}
