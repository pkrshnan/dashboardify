package httpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"dashboardify/internal/capture"
	webui "dashboardify/web"
)

const dashboardCSP = "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'"

var (
	dashboardFiles, dashboardHTML = loadDashboard()
	dashboardAssetHandler         = http.FileServerFS(dashboardFiles)
)

func loadDashboard() (fs.FS, []byte) {
	assets, err := fs.Sub(webui.Assets, "dist")
	if err != nil {
		panic("open embedded dashboard filesystem: " + err.Error())
	}
	document, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		panic("read embedded dashboard shell: " + err.Error())
	}
	return assets, document
}

type Authenticator interface {
	Middleware(http.Handler) http.Handler
}

type ServerConfig struct {
	Address       string
	ReadTimeout   time.Duration
	WriteTimeout  time.Duration
	IdleTimeout   time.Duration
	Authenticator Authenticator
	Captures      *capture.Service
}

func New(cfg ServerConfig, logger *slog.Logger) *http.Server {
	return &http.Server{
		Addr:         cfg.Address,
		Handler:      NewHandler(logger, cfg.Authenticator, cfg.Captures),
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}
}

func NewHandler(logger *slog.Logger, authenticator Authenticator, captures *capture.Service) http.Handler {
	application := http.NewServeMux()
	application.HandleFunc("GET /{$}", shell)
	application.Handle("GET /assets/", http.HandlerFunc(dashboardAsset))
	if captures != nil {
		api := captureAPI{service: captures, logger: logger}
		application.HandleFunc("GET /api/captures", api.list)
		application.HandleFunc("POST /api/captures", api.create)
		application.HandleFunc("POST /api/captures/preview", api.preview)
	}
	var protected http.Handler = application
	if authenticator != nil {
		protected = authenticator.Middleware(protected)
	}

	root := http.NewServeMux()
	root.HandleFunc("GET /live", live)
	root.Handle("/", protected)

	return requestID(securityHeaders(accessLog(logger, recoverPanic(logger, root))))
}

func live(response http.ResponseWriter, _ *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(response).Encode(map[string]string{"status": "ok"})
}

func shell(response http.ResponseWriter, _ *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = response.Write(dashboardHTML)
}

func dashboardAsset(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	dashboardAssetHandler.ServeHTTP(response, request)
}

type contextKey string

const requestIDKey contextKey = "request_id"

func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var bytes [16]byte
		if _, err := rand.Read(bytes[:]); err != nil {
			http.Error(response, "service unavailable", http.StatusServiceUnavailable)
			return
		}
		id := hex.EncodeToString(bytes[:])
		response.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(request.Context(), requestIDKey, id)
		next.ServeHTTP(response, request.WithContext(ctx))
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		header := response.Header()
		header.Set("Content-Security-Policy", dashboardCSP)
		header.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		header.Set("Referrer-Policy", "no-referrer")
		header.Set("X-Content-Type-Options", "nosniff")
		header.Set("X-Frame-Options", "DENY")
		next.ServeHTTP(response, request)
	})
}

type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (recorder *responseRecorder) WriteHeader(status int) {
	if recorder.status != 0 {
		return
	}
	recorder.status = status
	recorder.ResponseWriter.WriteHeader(status)
}

func (recorder *responseRecorder) Write(body []byte) (int, error) {
	if recorder.status == 0 {
		recorder.status = http.StatusOK
	}
	written, err := recorder.ResponseWriter.Write(body)
	recorder.bytes += written
	return written, err
}

func (recorder *responseRecorder) Unwrap() http.ResponseWriter {
	return recorder.ResponseWriter
}

func accessLog(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		started := time.Now()
		recorder := &responseRecorder{ResponseWriter: response}
		next.ServeHTTP(recorder, request)
		status := recorder.status
		if status == 0 {
			status = http.StatusOK
		}
		logger.InfoContext(request.Context(), "http.request",
			"request_id", request.Context().Value(requestIDKey),
			"method", request.Method,
			"route", routeName(request.URL.Path),
			"status", status,
			"response_bytes", recorder.bytes,
			"duration_ms", time.Since(started).Milliseconds(),
		)
	})
}

func routeName(path string) string {
	switch path {
	case "/live":
		return "live"
	case "/":
		return "shell"
	case "/api/captures":
		return "captures"
	case "/api/captures/preview":
		return "capture_preview"
	default:
		return "not_found"
	}
}

func recoverPanic(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.ErrorContext(request.Context(), "http.panic",
					"request_id", request.Context().Value(requestIDKey),
					"route", routeName(request.URL.Path),
					"error_class", "panic",
					"stack", string(debug.Stack()),
				)
				http.Error(response, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(response, request)
	})
}
