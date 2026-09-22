package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
)

const mutationRequestHeader = "X-Dashboardify-Request"

func acceptSameOriginJSON(response http.ResponseWriter, request *http.Request) bool {
	if request.Header.Get(mutationRequestHeader) != "dashboard-ui" {
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

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
