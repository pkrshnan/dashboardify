package httpserver

import (
	"errors"
	"net/http"

	"dashboardify/internal/capture"
)

type notificationUpdateRequest struct {
	State string `json:"state"`
}

func (api captureAPI) notifications(response http.ResponseWriter, request *http.Request) {
	notifications, err := api.service.Notifications(request.Context())
	if err != nil {
		api.logger.ErrorContext(request.Context(), "notifications.list_failed",
			"request_id", request.Context().Value(requestIDKey),
			"error", err,
		)
		http.Error(response, "service unavailable", http.StatusServiceUnavailable)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"notifications": notifications})
}

func (api captureAPI) updateNotification(response http.ResponseWriter, request *http.Request) {
	if !acceptSameOriginJSON(response, request) {
		return
	}
	var input notificationUpdateRequest
	if !decodeJSON(response, request, &input) {
		return
	}
	if input.State != "read" {
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": "notification state must be read"})
		return
	}
	if err := api.service.DismissNotification(request.Context(), request.PathValue("id")); err != nil {
		if errors.Is(err, capture.ErrNotificationNotFound) {
			writeJSON(response, http.StatusNotFound, map[string]string{"error": err.Error()})
			return
		}
		http.Error(response, "service unavailable", http.StatusServiceUnavailable)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}
