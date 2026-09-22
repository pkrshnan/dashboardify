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

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.Access.Enabled {
		t.Fatal("Access.Enabled = false, want true")
	}
}

func TestLoadRejectsPartialAccessConfig(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv("DASHBOARDIFY_CF_ACCESS_TEAM_DOMAIN", "team.cloudflareaccess.com")

	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted partial Cloudflare Access configuration")
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
		"DASHBOARDIFY_CF_ACCESS_TEAM_DOMAIN",
		"DASHBOARDIFY_CF_ACCESS_AUD",
		"DASHBOARDIFY_ALLOWED_SUBJECT",
	} {
		t.Setenv(key, "")
	}
}
