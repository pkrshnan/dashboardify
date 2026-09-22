package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"time"
)

type Environment string

const (
	Development Environment = "development"
	Production  Environment = "production"
)

var ErrAccessConfigRequired = errors.New("production startup requires complete Cloudflare Access configuration")

type AccessConfig struct {
	Enabled        bool
	TeamDomain     string
	Audience       string
	AllowedSubject string
}

type Config struct {
	Environment     Environment
	ListenAddress   string
	HomeTimezone    *time.Location
	LogLevel        string
	DatabasePath    string
	Access          AccessConfig
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	ShutdownTimeout time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Environment:     Environment(value("DASHBOARDIFY_ENV", string(Development))),
		ListenAddress:   value("DASHBOARDIFY_LISTEN_ADDR", "127.0.0.1:8080"),
		LogLevel:        value("DASHBOARDIFY_LOG_LEVEL", "info"),
		DatabasePath:    value("DASHBOARDIFY_DATABASE_PATH", "data/dashboardify.db"),
		ReadTimeout:     10 * time.Second,
		WriteTimeout:    15 * time.Second,
		IdleTimeout:     60 * time.Second,
		ShutdownTimeout: 10 * time.Second,
	}

	switch cfg.Environment {
	case Development, Production:
	default:
		return Config{}, fmt.Errorf("DASHBOARDIFY_ENV must be %q or %q", Development, Production)
	}

	switch cfg.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		return Config{}, errors.New("DASHBOARDIFY_LOG_LEVEL must be debug, info, warn, or error")
	}

	timezoneName := value("DASHBOARDIFY_HOME_TIMEZONE", "UTC")
	location, err := time.LoadLocation(timezoneName)
	if err != nil {
		return Config{}, fmt.Errorf("load DASHBOARDIFY_HOME_TIMEZONE %q: %w", timezoneName, err)
	}
	cfg.HomeTimezone = location

	if err := requireLoopback(cfg.ListenAddress); err != nil {
		return Config{}, err
	}

	cfg.Access = AccessConfig{
		TeamDomain:     value("DASHBOARDIFY_CF_ACCESS_TEAM_DOMAIN", ""),
		Audience:       value("DASHBOARDIFY_CF_ACCESS_AUD", ""),
		AllowedSubject: value("DASHBOARDIFY_ALLOWED_SUBJECT", ""),
	}
	accessValues := []string{cfg.Access.TeamDomain, cfg.Access.Audience, cfg.Access.AllowedSubject}
	providedValues := 0
	for _, item := range accessValues {
		if item != "" {
			providedValues++
		}
	}
	if providedValues != 0 && providedValues != len(accessValues) {
		return Config{}, errors.New("Cloudflare Access configuration must include team domain, audience, and allowed subject")
	}
	cfg.Access.Enabled = providedValues == len(accessValues)
	if cfg.Environment == Production && !cfg.Access.Enabled {
		return Config{}, ErrAccessConfigRequired
	}

	return cfg, nil
}

func value(key, fallback string) string {
	if current := strings.TrimSpace(os.Getenv(key)); current != "" {
		return current
	}
	return fallback
}

func requireLoopback(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("parse DASHBOARDIFY_LISTEN_ADDR %q: %w", address, err)
	}
	if strings.EqualFold(host, "localhost") {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("DASHBOARDIFY_LISTEN_ADDR must use a loopback host during development, got %q", host)
	}
	return nil
}
