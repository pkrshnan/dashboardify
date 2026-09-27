package httpserver

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"dashboardify/internal/calendar"
	"dashboardify/internal/capture"
)

type todayAPI struct {
	captures *capture.Service
	calendar *calendar.Service
	logger   *slog.Logger
}

func (api todayAPI) list(response http.ResponseWriter, request *http.Request) {
	view, err := api.captures.Today(request.Context(), request.URL.Query().Get("date"))
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
	events := make([]any, 0, len(view.Events)+8)
	for _, event := range view.Events {
		events = append(events, event)
	}
	if api.calendar != nil {
		location, err := time.LoadLocation(view.Timezone)
		if err != nil {
			api.logger.ErrorContext(request.Context(), "today.timezone_failed", "error", err)
			http.Error(response, "service unavailable", http.StatusServiceUnavailable)
			return
		}
		start, err := time.ParseInLocation(time.DateOnly, view.Date, location)
		if err != nil {
			writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": capture.ErrDateInvalid.Error()})
			return
		}
		external, err := api.calendar.ExternalAgenda(request.Context(), start, start.AddDate(0, 0, 1), location)
		if err != nil {
			api.logger.ErrorContext(request.Context(), "today.calendar_failed",
				"request_id", request.Context().Value(requestIDKey),
				"error", err,
			)
			http.Error(response, "service unavailable", http.StatusServiceUnavailable)
			return
		}
		for _, event := range external {
			events = append(events, event)
		}
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"date": view.Date, "timezone": view.Timezone, "tasks": view.Tasks, "events": events,
	})
}
