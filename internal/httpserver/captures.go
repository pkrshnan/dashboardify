package httpserver

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"dashboardify/internal/capture"
)

type captureAPI struct {
	service *capture.Service
	logger  *slog.Logger
}

type captureRequest struct {
	Text           string `json:"text"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

type classificationRequest struct {
	Kind              capture.Kind `json:"kind"`
	Title             string       `json:"title"`
	Subject           string       `json:"subject,omitempty"`
	ScheduledAt       string       `json:"scheduled_at,omitempty"`
	ScheduledDate     string       `json:"scheduled_date,omitempty"`
	OccurredDate      string       `json:"occurred_date,omitempty"`
	ScheduledTimezone string       `json:"scheduled_timezone,omitempty"`
	AllDay            bool         `json:"all_day,omitempty"`
	Place             string       `json:"place,omitempty"`
}

func (api captureAPI) preview(response http.ResponseWriter, request *http.Request) {
	if !acceptSameOriginJSON(response, request) {
		return
	}
	var input captureRequest
	if !decodeJSON(response, request, &input) {
		return
	}
	proposal, err := api.service.Preview(input.Text)
	if err != nil {
		writeCaptureError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, proposal)
}

func (api captureAPI) create(response http.ResponseWriter, request *http.Request) {
	if !acceptSameOriginJSON(response, request) {
		return
	}
	var input captureRequest
	if !decodeJSON(response, request, &input) {
		return
	}
	record, err := api.service.Create(request.Context(), input.IdempotencyKey, input.Text)
	if err != nil {
		if record.ID != "" {
			api.logger.ErrorContext(request.Context(), "capture.classification_failed",
				"request_id", request.Context().Value(requestIDKey),
				"capture_id", record.ID,
				"error", err,
			)
			writeJSON(response, http.StatusAccepted, record)
			return
		}
		writeCaptureError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, record)
}

func (api captureAPI) list(response http.ResponseWriter, request *http.Request) {
	records, err := api.service.List(request.Context(), 12)
	if err != nil {
		api.logger.ErrorContext(request.Context(), "capture.list_failed",
			"request_id", request.Context().Value(requestIDKey),
			"error", err,
		)
		http.Error(response, "service unavailable", http.StatusServiceUnavailable)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"captures": records})
}

func (api captureAPI) detail(response http.ResponseWriter, request *http.Request) {
	detail, err := api.service.Detail(request.Context(), request.PathValue("id"))
	if err != nil {
		writeCaptureError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, detail)
}

func (api captureAPI) classify(response http.ResponseWriter, request *http.Request) {
	if !acceptSameOriginJSON(response, request) {
		return
	}
	var input classificationRequest
	if !decodeJSON(response, request, &input) {
		return
	}
	proposal := capture.Proposal{
		Kind:              input.Kind,
		Title:             input.Title,
		Subject:           input.Subject,
		ScheduledDate:     input.ScheduledDate,
		OccurredDate:      input.OccurredDate,
		ScheduledTimezone: input.ScheduledTimezone,
		AllDay:            input.AllDay,
		Place:             input.Place,
	}
	if input.ScheduledAt != "" {
		value, err := time.Parse(time.RFC3339, input.ScheduledAt)
		if err != nil {
			writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": "scheduled_at must use RFC 3339"})
			return
		}
		proposal.ScheduledAt = &value
	}
	record, err := api.service.File(request.Context(), request.PathValue("id"), proposal)
	if err != nil {
		writeCaptureError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, record)
}

func writeCaptureError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, capture.ErrTextRequired),
		errors.Is(err, capture.ErrTextTooLong),
		errors.Is(err, capture.ErrIdempotencyRequired),
		errors.Is(err, capture.ErrIdempotencyInvalid),
		errors.Is(err, capture.ErrKindInvalid),
		errors.Is(err, capture.ErrSubjectRequired),
		errors.Is(err, capture.ErrDateInvalid):
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
	case errors.Is(err, capture.ErrIdempotencyConflict):
		writeJSON(response, http.StatusConflict, map[string]string{"error": "capture request conflicts with an earlier submission"})
	case errors.Is(err, capture.ErrCaptureNotFound):
		writeJSON(response, http.StatusNotFound, map[string]string{"error": err.Error()})
	default:
		http.Error(response, "service unavailable", http.StatusServiceUnavailable)
	}
}
