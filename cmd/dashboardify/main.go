package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"dashboardify/internal/accessauth"
	"dashboardify/internal/calendar"
	"dashboardify/internal/capture"
	"dashboardify/internal/config"
	"dashboardify/internal/httpserver"
	"dashboardify/internal/logging"
)

func main() {
	if err := run(); err != nil {
		slog.Error("service stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := logging.New(cfg.LogLevel)
	slog.SetDefault(logger)

	captureStore, err := capture.OpenStore(cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer captureStore.Close()
	captureService := capture.NewService(captureStore, capture.NewParser(cfg.HomeTimezone), time.Now)
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
		Authenticator: authenticator,
		Captures:      captureService,
		Calendar:      calendarService,
	}, logger)

	shutdownSignals, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if cfg.CalDAV.Enabled {
		go runCalendarSync(shutdownSignals, calendarService, cfg.CalDAV.SyncInterval, logger)
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
