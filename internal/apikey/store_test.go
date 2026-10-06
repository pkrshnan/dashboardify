package apikey

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func TestKeyLifecycleAuthenticatesScopeAndRevocation(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "dashboardify.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	key, token, err := store.Create(context.Background(), "iPhone Shortcut", []string{ScopeCapturesWrite})
	if err != nil {
		t.Fatal(err)
	}
	if token == "" || key.Name != "iPhone Shortcut" || len(key.Scopes) != 1 {
		t.Fatalf("created key = %#v, token present = %t", key, token != "")
	}

	authenticated, err := store.Authenticate(context.Background(), token, ScopeCapturesWrite)
	if err != nil {
		t.Fatal(err)
	}
	if authenticated.ID != key.ID || authenticated.LastUsedAt == nil {
		t.Fatalf("authenticated key = %#v", authenticated)
	}
	if _, err := store.Authenticate(context.Background(), token+"x", ScopeCapturesWrite); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("modified token error = %v, want ErrInvalidToken", err)
	}

	if err := store.Revoke(context.Background(), key.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Authenticate(context.Background(), token, ScopeCapturesWrite); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("revoked token error = %v, want ErrInvalidToken", err)
	}

	keys, err := store.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 || keys[0].RevokedAt == nil || keys[0].LastUsedAt == nil {
		t.Fatalf("listed keys = %#v", keys)
	}
}

func TestCreateRejectsUnsupportedScope(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if _, _, err := store.Create(context.Background(), "admin", []string{"admin"}); err == nil {
		t.Fatal("Create accepted unsupported scope")
	}
}
