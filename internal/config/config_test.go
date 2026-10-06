package config

import (
	"errors"
	"testing"
)

func TestLoadDevelopmentDefaults(t *testing.T) {
	clearConfigEnvironment(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Environment != Development {
		t.Fatalf("Environment = %q, want %q", cfg.Environment, Development)
	}
	if cfg.ListenAddress != "127.0.0.1:8080" {
		t.Fatalf("ListenAddress = %q, want loopback default", cfg.ListenAddress)
	}
	if cfg.HomeTimezone.String() != "UTC" {
		t.Fatalf("HomeTimezone = %q, want UTC", cfg.HomeTimezone)
	}
	if cfg.DatabasePath != "data/dashboardify.db" {
		t.Fatalf("DatabasePath = %q, want data/dashboardify.db", cfg.DatabasePath)
	}
}

func TestLoadRejectsRemoteDevelopmentBind(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_LISTEN_ADDR", "0.0.0.0:8080")

	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted a non-loopback development address")
	}
}

func TestLoadFailsClosedInProduction(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_ENV", "production")

	_, err := Load()
	if !errors.Is(err, ErrAccessConfigRequired) {
		t.Fatalf("Load() error = %v, want ErrAccessConfigRequired", err)
	}
}

func TestLoadAcceptsCompleteProductionAccessConfig(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_ENV", "production")
	t.Setenv("DASHBOARDIFY_CF_ACCESS_TEAM_DOMAIN", "team.cloudflareaccess.com")
	t.Setenv("DASHBOARDIFY_CF_ACCESS_AUD", "dashboard-audience")
	t.Setenv("DASHBOARDIFY_ALLOWED_SUBJECT", "owner-subject")
	t.Setenv("DASHBOARDIFY_DASHBOARD_HOST", "dashboard.pkrshnan.com")
	t.Setenv("DASHBOARDIFY_API_HOST", "dashboard-api.pkrshnan.com")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.Access.Enabled {
		t.Fatal("Access.Enabled = false, want true")
	}
}

func TestLoadRequiresDistinctProductionHosts(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_ENV", "production")
	t.Setenv("DASHBOARDIFY_DASHBOARD_HOST", "dashboard.pkrshnan.com")
	t.Setenv("DASHBOARDIFY_API_HOST", "dashboard.pkrshnan.com")

	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted identical dashboard and API hosts")
	}
}

func TestLoadRejectsHostnameWithPath(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_DASHBOARD_HOST", "dashboard.pkrshnan.com/private")
	t.Setenv("DASHBOARDIFY_API_HOST", "dashboard-api.pkrshnan.com")

	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted a dashboard hostname with a path")
	}
}

func TestLoadRejectsPartialAccessConfig(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_CF_ACCESS_TEAM_DOMAIN", "team.cloudflareaccess.com")

	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted partial Cloudflare Access configuration")
	}
}

func TestLoadAcceptsCompleteCalDAVConfig(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_CALDAV_ENDPOINT", "http://127.0.0.1:8181/")
	t.Setenv("DASHBOARDIFY_CALDAV_USERNAME", "calendar-owner")
	t.Setenv("DASHBOARDIFY_CALDAV_PASSWORD", "app-specific-password")
	t.Setenv("DASHBOARDIFY_CALDAV_CALENDAR_NAME", "Dashboardify Test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.CalDAV.Enabled || cfg.CalDAV.CalendarName != "Dashboardify Test" {
		t.Fatalf("CalDAV config = %#v", cfg.CalDAV)
	}
}

func TestLoadRejectsPartialOrInsecureCalDAVConfig(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_CALDAV_USERNAME", "calendar-owner")
	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted CalDAV username without password")
	}

	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_CALDAV_ENDPOINT", "http://calendar.example.com/")
	t.Setenv("DASHBOARDIFY_CALDAV_USERNAME", "calendar-owner")
	t.Setenv("DASHBOARDIFY_CALDAV_PASSWORD", "app-specific-password")
	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted non-loopback HTTP CalDAV endpoint")
	}
}

func TestLoadValidatesWebPushConfig(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_VAPID_PUBLIC_KEY", "public-key")
	t.Setenv("DASHBOARDIFY_VAPID_PRIVATE_KEY", "private-key")
	t.Setenv("DASHBOARDIFY_VAPID_SUBJECT", "mailto:owner@example.com")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.WebPush.Enabled {
		t.Fatal("WebPush.Enabled = false, want true")
	}

	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_VAPID_PUBLIC_KEY", "public-key")
	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted partial Web Push credentials")
	}

	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_VAPID_PUBLIC_KEY", "public-key")
	t.Setenv("DASHBOARDIFY_VAPID_PRIVATE_KEY", "private-key")
	t.Setenv("DASHBOARDIFY_VAPID_SUBJECT", "owner@example.com")
	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted an invalid VAPID subject")
	}
}

func TestLoadConfiguresTopLevelObsidianCaptureNote(t *testing.T) {
	clearConfigEnvironment(t)
	vault := t.TempDir()
	t.Setenv("DASHBOARDIFY_OBSIDIAN_VAULT_PATH", vault)
	t.Setenv("DASHBOARDIFY_OBSIDIAN_CAPTURE_FILE", "Inbox.md")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.Obsidian.Enabled || cfg.Obsidian.VaultPath != vault || cfg.Obsidian.CaptureFile != "Inbox.md" {
		t.Fatalf("Obsidian config = %#v", cfg.Obsidian)
	}
}

func TestLoadRejectsNestedObsidianCaptureNote(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_OBSIDIAN_VAULT_PATH", t.TempDir())
	t.Setenv("DASHBOARDIFY_OBSIDIAN_CAPTURE_FILE", "Inbox/Captures.md")

	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted a nested Obsidian capture file")
	}
}

func clearConfigEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"DASHBOARDIFY_ENV",
		"DASHBOARDIFY_LISTEN_ADDR",
		"DASHBOARDIFY_HOME_TIMEZONE",
		"DASHBOARDIFY_LOG_LEVEL",
		"DASHBOARDIFY_DATABASE_PATH",
		"DASHBOARDIFY_DASHBOARD_HOST",
		"DASHBOARDIFY_API_HOST",
		"DASHBOARDIFY_CF_ACCESS_TEAM_DOMAIN",
		"DASHBOARDIFY_CF_ACCESS_AUD",
		"DASHBOARDIFY_ALLOWED_SUBJECT",
		"DASHBOARDIFY_CALDAV_ENDPOINT",
		"DASHBOARDIFY_CALDAV_USERNAME",
		"DASHBOARDIFY_CALDAV_PASSWORD",
		"DASHBOARDIFY_CALDAV_CALENDAR_NAME",
		"DASHBOARDIFY_CALDAV_SYNC_INTERVAL",
		"DASHBOARDIFY_VAPID_PUBLIC_KEY",
		"DASHBOARDIFY_VAPID_PRIVATE_KEY",
		"DASHBOARDIFY_VAPID_SUBJECT",
		"DASHBOARDIFY_WEB_PUSH_INTERVAL",
		"DASHBOARDIFY_OBSIDIAN_VAULT_PATH",
		"DASHBOARDIFY_OBSIDIAN_CAPTURE_FILE",
	} {
		t.Setenv(key, "")
	}
}
