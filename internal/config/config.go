package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Environment string

const (
	Development Environment = "development"
	Production  Environment = "production"
)

var ErrAccessConfigRequired = errors.New("production startup requires complete Cloudflare Access configuration")
var ErrPublicHostsRequired = errors.New("production startup requires dashboard and API hostnames")

type AccessConfig struct {
	Enabled        bool
	TeamDomain     string
	Audience       string
	AllowedSubject string
}

type CalDAVConfig struct {
	Enabled      bool
	Endpoint     string
	Username     string
	Password     string
	CalendarName string
	SyncInterval time.Duration
}

type WebPushConfig struct {
	Enabled          bool
	PublicKey        string
	PrivateKey       string
	Subject          string
	DispatchInterval time.Duration
}

type ObsidianConfig struct {
	Enabled     bool
	VaultPath   string
	CaptureFile string
}

type Config struct {
	Environment     Environment
	ListenAddress   string
	HomeTimezone    *time.Location
	LogLevel        string
	DashboardHost   string
	APIHost         string
	DatabasePath    string
	Access          AccessConfig
	CalDAV          CalDAVConfig
	WebPush         WebPushConfig
	Obsidian        ObsidianConfig
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
	cfg.DashboardHost, err = optionalHostname("DASHBOARDIFY_DASHBOARD_HOST")
	if err != nil {
		return Config{}, err
	}
	cfg.APIHost, err = optionalHostname("DASHBOARDIFY_API_HOST")
	if err != nil {
		return Config{}, err
	}
	if (cfg.DashboardHost == "") != (cfg.APIHost == "") {
		return Config{}, errors.New("dashboard and API hostnames must be configured together")
	}
	if cfg.DashboardHost != "" && cfg.DashboardHost == cfg.APIHost {
		return Config{}, errors.New("dashboard and API hostnames must be different")
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
	if cfg.Environment == Production && (cfg.DashboardHost == "" || cfg.APIHost == "") {
		return Config{}, ErrPublicHostsRequired
	}

	cfg.CalDAV = CalDAVConfig{
		Endpoint:     value("DASHBOARDIFY_CALDAV_ENDPOINT", "https://caldav.icloud.com/"),
		Username:     value("DASHBOARDIFY_CALDAV_USERNAME", ""),
		Password:     value("DASHBOARDIFY_CALDAV_PASSWORD", ""),
		CalendarName: value("DASHBOARDIFY_CALDAV_CALENDAR_NAME", "Dashboardify"),
	}
	syncInterval, err := time.ParseDuration(value("DASHBOARDIFY_CALDAV_SYNC_INTERVAL", "5m"))
	if err != nil || syncInterval < time.Minute {
		return Config{}, errors.New("DASHBOARDIFY_CALDAV_SYNC_INTERVAL must be a duration of at least 1m")
	}
	cfg.CalDAV.SyncInterval = syncInterval
	calendarCredentials := 0
	for _, item := range []string{cfg.CalDAV.Username, cfg.CalDAV.Password} {
		if item != "" {
			calendarCredentials++
		}
	}
	if calendarCredentials != 0 && calendarCredentials != 2 {
		return Config{}, errors.New("CalDAV configuration must include both username and password")
	}
	cfg.CalDAV.Enabled = calendarCredentials == 2
	if cfg.CalDAV.Enabled {
		if err := validateCalDAVEndpoint(cfg.Environment, cfg.CalDAV.Endpoint); err != nil {
			return Config{}, err
		}
	}

	cfg.WebPush = WebPushConfig{
		PublicKey:  strings.TrimSpace(os.Getenv("DASHBOARDIFY_VAPID_PUBLIC_KEY")),
		PrivateKey: strings.TrimSpace(os.Getenv("DASHBOARDIFY_VAPID_PRIVATE_KEY")),
		Subject:    strings.TrimSpace(os.Getenv("DASHBOARDIFY_VAPID_SUBJECT")),
	}
	pushValues := []string{cfg.WebPush.PublicKey, cfg.WebPush.PrivateKey, cfg.WebPush.Subject}
	providedPushValues := 0
	for _, item := range pushValues {
		if item != "" {
			providedPushValues++
		}
	}
	if providedPushValues != 0 && providedPushValues != len(pushValues) {
		return Config{}, errors.New("web push configuration must include VAPID public key, private key, and subject")
	}
	cfg.WebPush.Enabled = providedPushValues == len(pushValues)
	if cfg.WebPush.Enabled && !validVAPIDSubject(cfg.WebPush.Subject) {
		return Config{}, errors.New("DASHBOARDIFY_VAPID_SUBJECT must be a mailto: or HTTPS URL")
	}
	pushInterval, err := time.ParseDuration(value("DASHBOARDIFY_WEB_PUSH_INTERVAL", "30s"))
	if err != nil || pushInterval < 5*time.Second {
		return Config{}, errors.New("DASHBOARDIFY_WEB_PUSH_INTERVAL must be a duration of at least 5s")
	}
	cfg.WebPush.DispatchInterval = pushInterval

	obsidianVault := strings.TrimSpace(os.Getenv("DASHBOARDIFY_OBSIDIAN_VAULT_PATH"))
	obsidianFile := value("DASHBOARDIFY_OBSIDIAN_CAPTURE_FILE", "Dashboardify Captures.md")
	if obsidianVault != "" {
		absoluteVault, err := filepath.Abs(obsidianVault)
		if err != nil {
			return Config{}, fmt.Errorf("resolve DASHBOARDIFY_OBSIDIAN_VAULT_PATH: %w", err)
		}
		info, err := os.Stat(absoluteVault)
		if err != nil || !info.IsDir() {
			return Config{}, errors.New("DASHBOARDIFY_OBSIDIAN_VAULT_PATH must be an existing directory")
		}
		if filepath.Base(obsidianFile) != obsidianFile || filepath.Ext(obsidianFile) != ".md" {
			return Config{}, errors.New("DASHBOARDIFY_OBSIDIAN_CAPTURE_FILE must be a top-level Markdown filename")
		}
		cfg.Obsidian = ObsidianConfig{
			Enabled:     true,
			VaultPath:   absoluteVault,
			CaptureFile: obsidianFile,
		}
	}

	return cfg, nil
}

func value(key, fallback string) string {
	if current := strings.TrimSpace(os.Getenv(key)); current != "" {
		return current
	}
	return fallback
}

func optionalHostname(key string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return "", nil
	}
	parsed, err := url.Parse("https://" + value)
	if err != nil || parsed.Hostname() == "" || parsed.Host != value || parsed.User != nil ||
		parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Port() != "" {
		return "", fmt.Errorf("%s must be a hostname without a scheme, port, path, query, or fragment", key)
	}
	return value, nil
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

func validateCalDAVEndpoint(environment Environment, endpoint string) error {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("DASHBOARDIFY_CALDAV_ENDPOINT must be an absolute URL without credentials, query, or fragment")
	}
	if parsed.Scheme == "https" {
		return nil
	}
	host := parsed.Hostname()
	if environment == Development && parsed.Scheme == "http" {
		if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
			return nil
		}
		if strings.EqualFold(host, "localhost") {
			return nil
		}
	}
	return errors.New("DASHBOARDIFY_CALDAV_ENDPOINT must use HTTPS")
}

func validVAPIDSubject(subject string) bool {
	parsed, err := url.Parse(subject)
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	if parsed.Scheme == "mailto" {
		return parsed.Opaque != "" || parsed.Path != ""
	}
	return parsed.Scheme == "https" && parsed.Host != ""
}
