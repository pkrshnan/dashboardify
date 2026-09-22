package httpserver

import (
	"errors"
	"net/http"

	"dashboardify/internal/capture"
)

func (api captureAPI) today(response http.ResponseWriter, request *http.Request) {
	view, err := api.service.Today(request.Context(), request.URL.Query().Get("date"))
	if err != nil {
		if errors.Is(err, capture.ErrDateInvalid) {
			writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		api.logger.ErrorContext(request.Context(), "today.list_failed",
			"request_id", request.Context().Value(requestIDKey),
			"error", err,
		)
		http.Error(response, "service unavailable", http.StatusServiceUnavailable)
		return
	}
	writeJSON(response, http.StatusOK, view)
}
