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
	}, logger)

	shutdownSignals, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

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
