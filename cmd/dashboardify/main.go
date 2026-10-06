package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"dashboardify/internal/accessauth"
	"dashboardify/internal/apikey"
	"dashboardify/internal/calendar"
	"dashboardify/internal/capture"
	"dashboardify/internal/config"
	"dashboardify/internal/httpserver"
	"dashboardify/internal/logging"
	"dashboardify/internal/obsidian"
	"dashboardify/internal/webpush"
)

func main() {
	if err := run(); err != nil {
		slog.Error("service stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) > 1 {
		if os.Args[1] != "api-key" {
			return fmt.Errorf("unknown command %q", os.Args[1])
		}
		databasePath := strings.TrimSpace(os.Getenv("DASHBOARDIFY_DATABASE_PATH"))
		if databasePath == "" {
			databasePath = "data/dashboardify.db"
		}
		return runAPIKeyCommand(context.Background(), databasePath, os.Args[2:], os.Stdout)
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := logging.New(cfg.LogLevel)
	slog.SetDefault(logger)

	apiKeyStore, err := apikey.OpenStore(cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer apiKeyStore.Close()

	captureStore, err := capture.OpenStore(cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer captureStore.Close()
	var captureWriter capture.CaptureWriter
	if cfg.Obsidian.Enabled {
		writer, err := obsidian.New(cfg.Obsidian.VaultPath, cfg.Obsidian.CaptureFile, cfg.HomeTimezone)
		if err != nil {
			return err
		}
		records, err := captureStore.ListAll(context.Background())
		if err != nil {
			return err
		}
		if err := writer.SyncCaptures(context.Background(), records); err != nil {
			return err
		}
		captureWriter = writer
		logger.Info("obsidian.capture_sync_ready",
			"vault", cfg.Obsidian.VaultPath,
			"file", cfg.Obsidian.CaptureFile,
			"captures", len(records),
		)
	}
	captureService := capture.NewService(captureStore, capture.NewParser(cfg.HomeTimezone), time.Now, captureWriter)
	calendarStore, err := calendar.OpenStore(cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer calendarStore.Close()
	calendarConfig := calendar.Config{
		Enabled:      cfg.CalDAV.Enabled,
		Endpoint:     cfg.CalDAV.Endpoint,
		Username:     cfg.CalDAV.Username,
		Password:     cfg.CalDAV.Password,
		CalendarName: cfg.CalDAV.CalendarName,
	}
	var calendarProvider calendar.Provider
	if calendarConfig.Enabled {
		calendarProvider, err = calendar.NewCalDAVProvider(calendarConfig)
		if err != nil {
			return err
		}
	}
	calendarService, err := calendar.NewService(context.Background(), calendarConfig, calendarStore, calendarProvider)
	if err != nil {
		return err
	}

	pushStore, err := webpush.OpenStore(cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer pushStore.Close()
	pushService, err := webpush.NewService(pushStore, webpush.Config{
		PublicKey:  cfg.WebPush.PublicKey,
		PrivateKey: cfg.WebPush.PrivateKey,
		Subject:    cfg.WebPush.Subject,
	})
	if err != nil {
		return err
	}

	var authenticator httpserver.Authenticator
	if cfg.Access.Enabled {
		authenticator, err = accessauth.New(accessauth.Config{
			TeamDomain:     cfg.Access.TeamDomain,
			Audience:       cfg.Access.Audience,
			AllowedSubject: cfg.Access.AllowedSubject,
		})
		if err != nil {
			return err
		}
	}

	server := httpserver.New(httpserver.ServerConfig{
		Address:       cfg.ListenAddress,
		ReadTimeout:   cfg.ReadTimeout,
		WriteTimeout:  cfg.WriteTimeout,
		IdleTimeout:   cfg.IdleTimeout,
		DashboardHost: cfg.DashboardHost,
		APIHost:       cfg.APIHost,
		APIKeys:       apiKeyStore,
		Authenticator: authenticator,
		Captures:      captureService,
		Calendar:      calendarService,
		WebPush:       pushService,
	}, logger)

	shutdownSignals, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if cfg.CalDAV.Enabled {
		go runCalendarSync(shutdownSignals, calendarService, cfg.CalDAV.SyncInterval, logger)
	}
	if cfg.WebPush.Enabled {
		go runPushDispatch(shutdownSignals, captureService, pushService, cfg.WebPush.DispatchInterval, logger)
	}

	serverError := make(chan error, 1)
	go func() {
		logger.Info("server.started",
			"address", cfg.ListenAddress,
			"environment", cfg.Environment,
			"home_timezone", cfg.HomeTimezone.String(),
		)
		serverError <- server.ListenAndServe()
	}()

	select {
	case err := <-serverError:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-shutdownSignals.Done():
		logger.Info("server.stopping")
		shutdownContext, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer cancel()
		if err := server.Shutdown(shutdownContext); err != nil {
			return err
		}
		if err := <-serverError; err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		logger.Info("server.stopped")
		return nil
	}
}

func runCalendarSync(ctx context.Context, service *calendar.Service, interval time.Duration, logger *slog.Logger) {
	synchronize := func() {
		summary, err := service.Sync(ctx)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				logger.ErrorContext(ctx, "calendar.sync_failed", "error", err)
			}
			return
		}
		logger.InfoContext(ctx, "calendar.synced",
			"pulled", summary.Pulled,
			"pushed", summary.Pushed,
			"deleted", summary.Deleted,
			"conflicts", summary.Conflicts,
		)
	}
	synchronize()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			synchronize()
		}
	}
}

func runPushDispatch(ctx context.Context, captures *capture.Service, pushes *webpush.Service, interval time.Duration, logger *slog.Logger) {
	dispatch := func() {
		if _, err := captures.Notifications(ctx); err != nil {
			if !errors.Is(err, context.Canceled) {
				logger.ErrorContext(ctx, "web_push.queue_failed", "error", err)
			}
			return
		}
		summary, err := pushes.Dispatch(ctx)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				logger.ErrorContext(ctx, "web_push.dispatch_failed", "error", err)
			}
			return
		}
		if summary.Sent != 0 || summary.Removed != 0 || summary.Failed != 0 {
			logger.InfoContext(ctx, "web_push.dispatched",
				"sent", summary.Sent,
				"removed", summary.Removed,
				"failed", summary.Failed,
			)
		}
	}
	dispatch()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			dispatch()
		}
	}
}
