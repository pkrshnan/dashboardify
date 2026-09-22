package httpserver

import (
	"errors"
	"net/http"
	"time"

	"dashboardify/internal/capture"
)

type taskUpdateRequest struct {
	Title             string `json:"title"`
	DueAt             string `json:"due_at,omitempty"`
	DueDate           string `json:"due_date,omitempty"`
	ReminderAt        string `json:"reminder_at,omitempty"`
	AllDay            bool   `json:"all_day,omitempty"`
	Place             string `json:"place,omitempty"`
	Status            string `json:"status"`
	CompletedAt       string `json:"completed_at,omitempty"`
	DeferredUntilDate string `json:"deferred_until_date,omitempty"`
}

func (api captureAPI) updateTask(response http.ResponseWriter, request *http.Request) {
	if !acceptSameOriginJSON(response, request) {
		return
	}
	var input taskUpdateRequest
	if !decodeJSON(response, request, &input) {
		return
	}
	update := capture.TaskUpdate{
		Title:             input.Title,
		DueDate:           input.DueDate,
		AllDay:            input.AllDay,
		Place:             input.Place,
		Status:            input.Status,
		DeferredUntilDate: input.DeferredUntilDate,
	}
	var err error
	if update.DueAt, err = parseOptionalRFC3339(input.DueAt); err != nil {
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": "due_at must use RFC 3339"})
		return
	}
	if update.ReminderAt, err = parseOptionalRFC3339(input.ReminderAt); err != nil {
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": "reminder_at must use RFC 3339"})
		return
	}
	if update.CompletedAt, err = parseOptionalRFC3339(input.CompletedAt); err != nil {
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": "completed_at must use RFC 3339"})
		return
	}
	task, err := api.service.UpdateTask(request.Context(), request.PathValue("id"), update)
	if err != nil {
		writeTaskError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, task)
}

func parseOptionalRFC3339(value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func writeTaskError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, capture.ErrTextRequired),
		errors.Is(err, capture.ErrTextTooLong),
		errors.Is(err, capture.ErrDateInvalid),
		errors.Is(err, capture.ErrTaskStatusInvalid):
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
	case errors.Is(err, capture.ErrTaskNotFound):
		writeJSON(response, http.StatusNotFound, map[string]string{"error": err.Error()})
	default:
		http.Error(response, "service unavailable", http.StatusServiceUnavailable)
	}
}
