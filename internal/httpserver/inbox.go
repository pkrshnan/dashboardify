package httpserver

import "net/http"

func (api captureAPI) inbox(response http.ResponseWriter, request *http.Request) {
	records, err := api.service.Inbox(request.Context(), 50)
	if err != nil {
		api.logger.ErrorContext(request.Context(), "capture.inbox_failed",
			"request_id", request.Context().Value(requestIDKey),
			"error", err,
		)
		http.Error(response, "service unavailable", http.StatusServiceUnavailable)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"captures": records})
}
