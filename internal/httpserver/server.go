package httpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"dashboardify/internal/apikey"
	"dashboardify/internal/calendar"
	"dashboardify/internal/capture"
	"dashboardify/internal/webpush"
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
	DashboardHost string
	APIHost       string
	APIKeys       *apikey.Store
	Captures      *capture.Service
	WebPush       *webpush.Service
	Calendar      *calendar.Service
}

func New(cfg ServerConfig, logger *slog.Logger) *http.Server {
	return &http.Server{
		Addr:              cfg.Address,
		Handler:           NewHandlerForHosts(logger, cfg.DashboardHost, cfg.APIHost, cfg.Authenticator, cfg.APIKeys, cfg.Captures, cfg.Calendar, cfg.WebPush),
		ReadHeaderTimeout: cfg.ReadTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
		MaxHeaderBytes:    32 << 10,
	}
}

func NewHandler(logger *slog.Logger, authenticator Authenticator, captures *capture.Service) http.Handler {
	return NewHandlerWithCalendar(logger, authenticator, captures, nil)
}

func NewHandlerWithCalendar(logger *slog.Logger, authenticator Authenticator, captures *capture.Service, calendars *calendar.Service) http.Handler {
	root := http.NewServeMux()
	root.HandleFunc("GET /live", live)
	root.Handle("/", dashboardApplication(logger, authenticator, captures, calendars, nil))
	return requestID(securityHeaders(accessLog(logger, recoverPanic(logger, root))))
}

func NewHandlerForHosts(
	logger *slog.Logger,
	dashboardHost string,
	apiHost string,
	authenticator Authenticator,
	apiKeys *apikey.Store,
	captures *capture.Service,
	calendars *calendar.Service,
	pushes *webpush.Service,
) http.Handler {
	if dashboardHost == "" && apiHost == "" {
		root := http.NewServeMux()
		root.HandleFunc("GET /live", live)
		root.Handle("/", dashboardApplication(logger, authenticator, captures, calendars, pushes))
		return requestID(securityHeaders(accessLog(logger, recoverPanic(logger, root))))
	}
	dashboard := dashboardApplication(logger, authenticator, captures, calendars, pushes)
	api := publicAPI(apiKeys, captures)
	root := http.NewServeMux()
	root.HandleFunc("GET /live", live)
	root.Handle("/", http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch requestHostname(request) {
		case dashboardHost:
			dashboard.ServeHTTP(response, request)
		case apiHost:
			api.ServeHTTP(response, request)
		default:
			http.Error(response, "not found", http.StatusNotFound)
		}
	}))
	return requestID(securityHeaders(accessLog(logger, recoverPanic(logger, root))))
}

func dashboardApplication(logger *slog.Logger, authenticator Authenticator, captures *capture.Service, calendars *calendar.Service, pushes *webpush.Service) http.Handler {
	application := http.NewServeMux()
	application.HandleFunc("GET /{$}", shell)
	application.HandleFunc("GET /inbox", shell)
	application.HandleFunc("GET /calendar", shell)
	application.Handle("GET /assets/", http.HandlerFunc(dashboardAsset))
	application.HandleFunc("GET /manifest.webmanifest", dashboardStaticAsset)
	application.HandleFunc("GET /service-worker.js", dashboardServiceWorker)
	application.Handle("GET /icons/", http.HandlerFunc(dashboardStaticAsset))
	if captures != nil {
		api := captureAPI{service: captures, logger: logger}
		application.HandleFunc("GET /api/captures", api.list)
		application.HandleFunc("POST /api/captures", api.create)
		application.HandleFunc("POST /api/captures/preview", api.preview)
		application.HandleFunc("GET /api/inbox", api.inbox)
		application.HandleFunc("GET /api/captures/{id}", api.detail)
		application.HandleFunc("DELETE /api/captures/{id}", api.delete)
		application.HandleFunc("PUT /api/captures/{id}/classification", api.classify)
		application.HandleFunc("GET /api/today", (todayAPI{captures: captures, calendar: calendars, logger: logger}).list)
		application.HandleFunc("PUT /api/tasks/{id}", api.updateTask)
		application.HandleFunc("GET /api/notifications", api.notifications)
		application.HandleFunc("PATCH /api/notifications/{id}", api.updateNotification)
	}
	if pushes != nil {
		api := pushAPI{service: pushes, logger: logger}
		application.HandleFunc("GET /api/push/config", api.config)
		application.HandleFunc("PUT /api/push/subscription", api.subscribe)
		application.HandleFunc("DELETE /api/push/subscription", api.unsubscribe)
	}
	if calendars != nil {
		api := calendarAPI{service: calendars, logger: logger}
		application.HandleFunc("GET /api/calendar/status", api.status)
		application.HandleFunc("POST /api/calendar/discover", api.discover)
		application.HandleFunc("POST /api/calendar/sync", api.sync)
		application.HandleFunc("GET /api/calendar/conflicts", api.conflicts)
		application.HandleFunc("PUT /api/calendar/conflicts/{id}", api.resolveConflict)
		application.HandleFunc("PUT /api/events/{id}", api.updateEvent)
	}
	var protected http.Handler = application
	if authenticator != nil {
		protected = authenticator.Middleware(protected)
	}
	return protected
}

func publicAPI(apiKeys *apikey.Store, captures *capture.Service) http.Handler {
	application := http.NewServeMux()
	if apiKeys != nil && captures != nil {
		application.Handle("POST /v1/captures", requireAPIKey(apiKeys, apikey.ScopeCapturesWrite, http.HandlerFunc((captureAPI{service: captures}).createPublic)))
	}
	return application
}

func requireAPIKey(store *apikey.Store, scope string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		scheme, token, ok := strings.Cut(strings.TrimSpace(request.Header.Get("Authorization")), " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(token) == "" {
			response.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(response, "unauthorized", http.StatusUnauthorized)
			return
		}
		_, err := store.Authenticate(request.Context(), strings.TrimSpace(token), scope)
		switch {
		case err == nil:
			next.ServeHTTP(response, request)
		case errors.Is(err, apikey.ErrInvalidToken):
			response.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(response, "unauthorized", http.StatusUnauthorized)
		case errors.Is(err, apikey.ErrForbidden):
			http.Error(response, "forbidden", http.StatusForbidden)
		default:
			http.Error(response, "service unavailable", http.StatusServiceUnavailable)
		}
	})
}

func requestHostname(request *http.Request) string {
	host := strings.ToLower(strings.TrimSpace(request.Host))
	if hostname, _, err := net.SplitHostPort(host); err == nil {
		return hostname
	}
	return host
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

func dashboardStaticAsset(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Cache-Control", "public, max-age=86400")
	dashboardAssetHandler.ServeHTTP(response, request)
}

func dashboardServiceWorker(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("Service-Worker-Allowed", "/")
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
	case "/api/inbox":
		return "inbox"
	case "/api/today":
		return "today"
	case "/api/calendar/status":
		return "calendar_status"
	case "/api/calendar/discover":
		return "calendar_discover"
	case "/api/calendar/sync":
		return "calendar_sync"
	case "/api/calendar/conflicts":
		return "calendar_conflicts"
	case "/api/push/config", "/api/push/subscription":
		return "web_push"
	default:
		switch {
		case strings.HasPrefix(path, "/api/tasks/"):
			return "tasks"
		case strings.HasPrefix(path, "/api/calendar/conflicts/"):
			return "calendar_conflict"
		case strings.HasPrefix(path, "/api/events/"):
			return "events"
		case strings.HasPrefix(path, "/api/notifications"):
			return "notifications"
		case strings.HasPrefix(path, "/icons/"), path == "/manifest.webmanifest", path == "/service-worker.js":
			return "pwa_asset"
		case strings.HasPrefix(path, "/api/captures/"):
			return "capture_detail"
		default:
			return "not_found"
		}
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
