package httpserver

import (
	"errors"
	"log/slog"
	"net/http"

	"dashboardify/internal/webpush"
)

type pushAPI struct {
	service *webpush.Service
	logger  *slog.Logger
}

type pushUnsubscribeRequest struct {
	Endpoint string `json:"endpoint"`
}

func (api pushAPI) config(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{
		"enabled":    api.service.Enabled(),
		"public_key": api.service.PublicKey(),
	})
}

func (api pushAPI) subscribe(response http.ResponseWriter, request *http.Request) {
	if !acceptSameOriginJSON(response, request) {
		return
	}
	var subscription webpush.Subscription
	if !decodeJSON(response, request, &subscription) {
		return
	}
	if err := api.service.Subscribe(request.Context(), subscription); err != nil {
		switch {
		case errors.Is(err, webpush.ErrInvalidSubscription):
			writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		case errors.Is(err, webpush.ErrDisabled):
			writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		default:
			api.logger.ErrorContext(request.Context(), "web_push.subscribe_failed", "error", err)
			writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "device alerts could not be enabled"})
		}
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (api pushAPI) unsubscribe(response http.ResponseWriter, request *http.Request) {
	if !acceptSameOriginJSON(response, request) {
		return
	}
	var input pushUnsubscribeRequest
	if !decodeJSON(response, request, &input) {
		return
	}
	if err := api.service.Unsubscribe(request.Context(), input.Endpoint); err != nil {
		switch {
		case errors.Is(err, webpush.ErrInvalidSubscription):
			writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		case errors.Is(err, webpush.ErrDisabled):
			writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		default:
			api.logger.ErrorContext(request.Context(), "web_push.unsubscribe_failed", "error", err)
			writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "device alerts could not be disabled"})
		}
		return
	}
	response.WriteHeader(http.StatusNoContent)
}
