package apikey

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

const (
	ScopeCapturesWrite = "captures:write"
	tokenPrefix        = "dsh_live_"
)

var (
	ErrInvalidToken = errors.New("invalid API key")
	ErrForbidden    = errors.New("API key does not grant the required scope")
)

type Key struct {
	ID         string
	Name       string
	Scopes     []string
	CreatedAt  time.Time
	LastUsedAt *time.Time
	RevokedAt  *time.Time
}

type Store struct {
	database *sql.DB
	now      func() time.Time
}

func OpenStore(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("database path is required")
	}
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}
	database, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open API key database: %w", err)
	}
	database.SetMaxOpenConns(1)
	if _, err := database.Exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;`); err != nil {
		_ = database.Close()
		return nil, fmt.Errorf("configure API key database: %w", err)
	}
	if path != ":memory:" {
		if err := os.Chmod(path, 0o600); err != nil {
			_ = database.Close()
			return nil, fmt.Errorf("protect API key database: %w", err)
		}
	}
	store := &Store{database: database, now: time.Now}
	if err := store.migrate(context.Background()); err != nil {
		_ = database.Close()
		return nil, err
	}
	return store, nil
}

func (store *Store) Close() error {
	return store.database.Close()
}

func (store *Store) migrate(ctx context.Context) error {
	_, err := store.database.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS api_key_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    secret_hash BLOB NOT NULL,
    created_at_utc TEXT NOT NULL,
    last_used_at_utc TEXT,
    revoked_at_utc TEXT
);
CREATE TABLE IF NOT EXISTS api_key_scopes (
    api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    PRIMARY KEY(api_key_id, scope)
);
INSERT OR IGNORE INTO api_key_schema_migrations(version, applied_at_utc) VALUES(1, ?);
`, store.now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("migrate API key database: %w", err)
	}
	return nil
}

func (store *Store) Create(ctx context.Context, name string, scopes []string) (Key, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return Key{}, "", errors.New("API key name must contain 1 to 100 characters")
	}
	scopes, err := normalizeScopes(scopes)
	if err != nil {
		return Key{}, "", err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return Key{}, "", fmt.Errorf("generate API key ID: %w", err)
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return Key{}, "", fmt.Errorf("generate API key secret: %w", err)
	}
	token := tokenPrefix + id.String() + "." + base64.RawURLEncoding.EncodeToString(secret)
	hash := sha256.Sum256([]byte(token))
	createdAt := store.now().UTC()

	transaction, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return Key{}, "", fmt.Errorf("begin API key creation: %w", err)
	}
	defer transaction.Rollback()
	if _, err := transaction.ExecContext(ctx,
		`INSERT INTO api_keys(id, name, secret_hash, created_at_utc) VALUES(?, ?, ?, ?)`,
		id.String(), name, hash[:], createdAt.Format(time.RFC3339Nano),
	); err != nil {
		return Key{}, "", fmt.Errorf("insert API key: %w", err)
	}
	for _, scope := range scopes {
		if _, err := transaction.ExecContext(ctx,
			`INSERT INTO api_key_scopes(api_key_id, scope) VALUES(?, ?)`, id.String(), scope,
		); err != nil {
			return Key{}, "", fmt.Errorf("insert API key scope: %w", err)
		}
	}
	if err := transaction.Commit(); err != nil {
		return Key{}, "", fmt.Errorf("commit API key creation: %w", err)
	}
	return Key{ID: id.String(), Name: name, Scopes: scopes, CreatedAt: createdAt}, token, nil
}

func (store *Store) Authenticate(ctx context.Context, token, requiredScope string) (Key, error) {
	id, ok := tokenID(strings.TrimSpace(token))
	if !ok {
		return Key{}, ErrInvalidToken
	}
	key, expectedHash, err := store.keyByID(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || key.RevokedAt != nil {
		return Key{}, ErrInvalidToken
	}
	if err != nil {
		return Key{}, err
	}
	actualHash := sha256.Sum256([]byte(token))
	if len(expectedHash) != sha256.Size || subtle.ConstantTimeCompare(expectedHash, actualHash[:]) != 1 {
		return Key{}, ErrInvalidToken
	}
	if !hasScope(key.Scopes, requiredScope) {
		return Key{}, ErrForbidden
	}
	now := store.now().UTC()
	if _, err := store.database.ExecContext(ctx,
		`UPDATE api_keys SET last_used_at_utc = ? WHERE id = ?`, now.Format(time.RFC3339Nano), key.ID,
	); err != nil {
		return Key{}, fmt.Errorf("record API key use: %w", err)
	}
	key.LastUsedAt = &now
	return key, nil
}

func (store *Store) List(ctx context.Context) ([]Key, error) {
	rows, err := store.database.QueryContext(ctx, `
SELECT keys.id, keys.name, keys.created_at_utc, keys.last_used_at_utc, keys.revoked_at_utc,
       GROUP_CONCAT(scopes.scope, ',')
FROM api_keys AS keys
JOIN api_key_scopes AS scopes ON scopes.api_key_id = keys.id
GROUP BY keys.id
ORDER BY keys.created_at_utc, keys.id`)
	if err != nil {
		return nil, fmt.Errorf("list API keys: %w", err)
	}
	defer rows.Close()
	var keys []Key
	for rows.Next() {
		var key Key
		var createdAt, scopes string
		var lastUsedAt, revokedAt sql.NullString
		if err := rows.Scan(&key.ID, &key.Name, &createdAt, &lastUsedAt, &revokedAt, &scopes); err != nil {
			return nil, fmt.Errorf("scan API key: %w", err)
		}
		key.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
		if err != nil {
			return nil, fmt.Errorf("parse API key creation time: %w", err)
		}
		if lastUsedAt.Valid {
			value, err := time.Parse(time.RFC3339Nano, lastUsedAt.String)
			if err != nil {
				return nil, fmt.Errorf("parse API key last-use time: %w", err)
			}
			key.LastUsedAt = &value
		}
		if revokedAt.Valid {
			value, err := time.Parse(time.RFC3339Nano, revokedAt.String)
			if err != nil {
				return nil, fmt.Errorf("parse API key revocation time: %w", err)
			}
			key.RevokedAt = &value
		}
		key.Scopes = strings.Split(scopes, ",")
		sort.Strings(key.Scopes)
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate API keys: %w", err)
	}
	return keys, nil
}

func (store *Store) Revoke(ctx context.Context, id string) error {
	if _, err := uuid.Parse(id); err != nil {
		return errors.New("API key ID must be a UUID")
	}
	result, err := store.database.ExecContext(ctx,
		`UPDATE api_keys SET revoked_at_utc = COALESCE(revoked_at_utc, ?) WHERE id = ?`,
		store.now().UTC().Format(time.RFC3339Nano), id,
	)
	if err != nil {
		return fmt.Errorf("revoke API key: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect API key revocation: %w", err)
	}
	if changed == 0 {
		return errors.New("API key not found")
	}
	return nil
}

func (store *Store) keyByID(ctx context.Context, id string) (Key, []byte, error) {
	var key Key
	var hash []byte
	var createdAt string
	var lastUsedAt, revokedAt sql.NullString
	err := store.database.QueryRowContext(ctx, `
SELECT id, name, secret_hash, created_at_utc, last_used_at_utc, revoked_at_utc
FROM api_keys WHERE id = ?`, id).Scan(
		&key.ID, &key.Name, &hash, &createdAt, &lastUsedAt, &revokedAt,
	)
	if err != nil {
		return Key{}, nil, err
	}
	key.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return Key{}, nil, fmt.Errorf("parse API key creation time: %w", err)
	}
	if lastUsedAt.Valid {
		value, err := time.Parse(time.RFC3339Nano, lastUsedAt.String)
		if err != nil {
			return Key{}, nil, fmt.Errorf("parse API key last-use time: %w", err)
		}
		key.LastUsedAt = &value
	}
	if revokedAt.Valid {
		value, err := time.Parse(time.RFC3339Nano, revokedAt.String)
		if err != nil {
			return Key{}, nil, fmt.Errorf("parse API key revocation time: %w", err)
		}
		key.RevokedAt = &value
	}
	rows, err := store.database.QueryContext(ctx,
		`SELECT scope FROM api_key_scopes WHERE api_key_id = ? ORDER BY scope`, id,
	)
	if err != nil {
		return Key{}, nil, fmt.Errorf("read API key scopes: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var scope string
		if err := rows.Scan(&scope); err != nil {
			return Key{}, nil, fmt.Errorf("scan API key scope: %w", err)
		}
		key.Scopes = append(key.Scopes, scope)
	}
	if err := rows.Err(); err != nil {
		return Key{}, nil, fmt.Errorf("iterate API key scopes: %w", err)
	}
	return key, hash, nil
}

func tokenID(token string) (string, bool) {
	if !strings.HasPrefix(token, tokenPrefix) {
		return "", false
	}
	id, secret, ok := strings.Cut(strings.TrimPrefix(token, tokenPrefix), ".")
	if !ok || len(secret) != 43 {
		return "", false
	}
	if _, err := uuid.Parse(id); err != nil {
		return "", false
	}
	if decoded, err := base64.RawURLEncoding.DecodeString(secret); err != nil || len(decoded) != 32 {
		return "", false
	}
	return id, true
}

func normalizeScopes(scopes []string) ([]string, error) {
	unique := make(map[string]struct{}, len(scopes))
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if scope != ScopeCapturesWrite {
			return nil, fmt.Errorf("unsupported API key scope %q", scope)
		}
		unique[scope] = struct{}{}
	}
	if len(unique) == 0 {
		return nil, errors.New("at least one API key scope is required")
	}
	result := make([]string, 0, len(unique))
	for scope := range unique {
		result = append(result, scope)
	}
	sort.Strings(result)
	return result, nil
}

func hasScope(scopes []string, required string) bool {
	for _, scope := range scopes {
		if scope == required {
			return true
		}
	}
	return false
}
