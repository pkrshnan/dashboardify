package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"

	"dashboardify/internal/capture"
)

const captureRequestHeader = "X-Dashboardify-Request"

type captureAPI struct {
	service *capture.Service
	logger  *slog.Logger
}

type captureRequest struct {
	Text           string `json:"text"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
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

func acceptSameOriginJSON(response http.ResponseWriter, request *http.Request) bool {
	if request.Header.Get(captureRequestHeader) != "capture-ui" {
		http.Error(response, "forbidden", http.StatusForbidden)
		return false
	}
	origin, err := url.Parse(request.Header.Get("Origin"))
	if err != nil || origin.Scheme == "" || origin.Host != request.Host || origin.User != nil {
		http.Error(response, "forbidden", http.StatusForbidden)
		return false
	}
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		http.Error(response, "content type must be application/json", http.StatusUnsupportedMediaType)
		return false
	}
	return true
}

func decodeJSON(response http.ResponseWriter, request *http.Request, target any) bool {
	request.Body = http.MaxBytesReader(response, request.Body, 8<<10)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		http.Error(response, "invalid request body", http.StatusBadRequest)
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		http.Error(response, "invalid request body", http.StatusBadRequest)
		return false
	}
	return true
}

func writeCaptureError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, capture.ErrTextRequired),
		errors.Is(err, capture.ErrTextTooLong),
		errors.Is(err, capture.ErrIdempotencyRequired),
		errors.Is(err, capture.ErrIdempotencyInvalid):
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
	case errors.Is(err, capture.ErrIdempotencyConflict):
		writeJSON(response, http.StatusConflict, map[string]string{"error": "capture request conflicts with an earlier submission"})
	default:
		http.Error(response, "service unavailable", http.StatusServiceUnavailable)
	}
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
