package capture

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

var ErrIdempotencyConflict = errors.New("idempotency key was already used for different capture text")

type Record struct {
	ID                string     `json:"id"`
	RawText           string     `json:"raw_text"`
	Kind              Kind       `json:"kind"`
	Title             string     `json:"title"`
	ScheduledAt       *time.Time `json:"scheduled_at,omitempty"`
	ScheduledDate     string     `json:"scheduled_date,omitempty"`
	ScheduledTimezone string     `json:"scheduled_timezone,omitempty"`
	AllDay            bool       `json:"all_day,omitempty"`
	DisplayWhen       string     `json:"display_when,omitempty"`
	Place             string     `json:"place,omitempty"`
	State             string     `json:"state"`
	CapturedAt        time.Time  `json:"captured_at"`
}

type Store struct {
	database *sql.DB
}

const schemaV1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS captures (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    raw_text TEXT NOT NULL,
    captured_at_utc TEXT NOT NULL,
    interpreted_timezone TEXT NOT NULL,
    resolution_state TEXT NOT NULL CHECK (resolution_state IN ('pending', 'resolved')),
    kind TEXT NOT NULL CHECK (kind IN ('pending', 'reminder', 'event', 'note')),
    title TEXT NOT NULL DEFAULT '',
    scheduled_at_utc TEXT,
    place TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    capture_id TEXT NOT NULL UNIQUE REFERENCES captures(id),
    title TEXT NOT NULL,
    remind_at_utc TEXT,
    timezone TEXT NOT NULL,
    place TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'archived')),
    created_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    capture_id TEXT NOT NULL UNIQUE REFERENCES captures(id),
    title TEXT NOT NULL,
    start_at_utc TEXT,
    timezone TEXT NOT NULL,
    place TEXT NOT NULL DEFAULT '',
    created_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    capture_id TEXT NOT NULL UNIQUE REFERENCES captures(id),
    body TEXT NOT NULL,
    created_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS captures_captured_at_idx ON captures(captured_at_utc DESC);
`

const schemaV2 = `
ALTER TABLE captures ADD COLUMN scheduled_date_local TEXT NOT NULL DEFAULT '';
ALTER TABLE captures ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1));
ALTER TABLE tasks ADD COLUMN due_date_local TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1));
ALTER TABLE events ADD COLUMN start_date_local TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1));
`

func OpenStore(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("database path is required")
	}
	if path != ":memory:" {
		directory := filepath.Dir(path)
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}

	database, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	database.SetMaxOpenConns(1)
	if _, err := database.Exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;`); err != nil {
		_ = database.Close()
		return nil, fmt.Errorf("configure database: %w", err)
	}
	store := &Store{database: database}
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
	transaction, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration: %w", err)
	}
	defer transaction.Rollback()
	if _, err := transaction.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at_utc TEXT NOT NULL
)`); err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}
	var currentVersion int
	if err := transaction.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&currentVersion); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	for index, migration := range []string{schemaV1, schemaV2} {
		version := index + 1
		if version <= currentVersion {
			continue
		}
		if _, err := transaction.ExecContext(ctx, migration); err != nil {
			return fmt.Errorf("apply schema migration %d: %w", version, err)
		}
		if _, err := transaction.ExecContext(ctx,
			`INSERT INTO schema_migrations(version, applied_at_utc) VALUES(?, ?)`,
			version,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			return fmt.Errorf("record schema migration %d: %w", version, err)
		}
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit capture migration: %w", err)
	}
	return nil
}

func (store *Store) InsertRaw(ctx context.Context, key, rawText, timezone string, capturedAt time.Time) (Record, bool, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return Record{}, false, fmt.Errorf("generate capture id: %w", err)
	}
	result, err := store.database.ExecContext(ctx, `
INSERT INTO captures(id, idempotency_key, raw_text, captured_at_utc, interpreted_timezone, resolution_state, kind)
VALUES(?, ?, ?, ?, ?, 'pending', 'pending')
ON CONFLICT(idempotency_key) DO NOTHING`,
		id.String(), key, rawText, capturedAt.UTC().Format(time.RFC3339Nano), timezone,
	)
	if err != nil {
		return Record{}, false, fmt.Errorf("insert raw capture: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return Record{}, false, fmt.Errorf("inspect raw capture insert: %w", err)
	}
	if rows == 0 {
		record, existingText, err := store.byIdempotencyKey(ctx, key)
		if err != nil {
			return Record{}, false, err
		}
		if existingText != rawText {
			return Record{}, false, ErrIdempotencyConflict
		}
		return record, false, nil
	}
	return Record{
		ID:         id.String(),
		RawText:    rawText,
		Kind:       Kind("pending"),
		State:      "pending",
		CapturedAt: capturedAt.UTC(),
	}, true, nil
}

func (store *Store) Resolve(ctx context.Context, captureID string, proposal Proposal, resolvedAt time.Time) error {
	transaction, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin capture resolution: %w", err)
	}
	defer transaction.Rollback()

	var state string
	if err := transaction.QueryRowContext(ctx, `SELECT resolution_state FROM captures WHERE id = ?`, captureID).Scan(&state); err != nil {
		return fmt.Errorf("read capture resolution state: %w", err)
	}
	if state == "resolved" {
		return transaction.Commit()
	}

	recordID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate record id: %w", err)
	}
	when := nullableTime(proposal.ScheduledAt)
	allDay := boolInt(proposal.AllDay)
	createdAt := resolvedAt.UTC().Format(time.RFC3339Nano)
	switch proposal.Kind {
	case KindReminder:
		_, err = transaction.ExecContext(ctx, `
INSERT INTO tasks(id, capture_id, title, remind_at_utc, due_date_local, all_day, timezone, place, created_at_utc)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			recordID.String(), captureID, proposal.Title, when, proposal.ScheduledDate, allDay,
			proposal.ScheduledTimezone, proposal.Place, createdAt)
	case KindEvent:
		_, err = transaction.ExecContext(ctx, `
INSERT INTO events(id, capture_id, title, start_at_utc, start_date_local, all_day, timezone, place, created_at_utc)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			recordID.String(), captureID, proposal.Title, when, proposal.ScheduledDate, allDay,
			proposal.ScheduledTimezone, proposal.Place, createdAt)
	case KindNote:
		_, err = transaction.ExecContext(ctx, `
INSERT INTO notes(id, capture_id, body, created_at_utc)
VALUES(?, ?, ?, ?)`, recordID.String(), captureID, proposal.Title, createdAt)
	default:
		return fmt.Errorf("unsupported capture kind %q", proposal.Kind)
	}
	if err != nil {
		return fmt.Errorf("insert %s record: %w", proposal.Kind, err)
	}
	if _, err := transaction.ExecContext(ctx, `
UPDATE captures
SET resolution_state = 'resolved', kind = ?, title = ?, scheduled_at_utc = ?, scheduled_date_local = ?, all_day = ?, place = ?
WHERE id = ?`,
		proposal.Kind, proposal.Title, when, proposal.ScheduledDate, allDay, proposal.Place, captureID,
	); err != nil {
		return fmt.Errorf("finish capture resolution: %w", err)
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit capture resolution: %w", err)
	}
	return nil
}

func (store *Store) ByID(ctx context.Context, id string) (Record, error) {
	row := store.database.QueryRowContext(ctx, recordQuery+` WHERE id = ?`, id)
	record, _, err := scanRecord(row)
	return record, err
}

func (store *Store) List(ctx context.Context, limit int) ([]Record, error) {
	rows, err := store.database.QueryContext(ctx, recordQuery+` ORDER BY captured_at_utc DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list captures: %w", err)
	}
	defer rows.Close()

	records := make([]Record, 0, limit)
	for rows.Next() {
		record, _, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate captures: %w", err)
	}
	return records, nil
}

const recordQuery = `
SELECT id, raw_text, kind, title, scheduled_at_utc, scheduled_date_local, interpreted_timezone, all_day, place, resolution_state, captured_at_utc, idempotency_key
FROM captures`

type rowScanner interface {
	Scan(...any) error
}

func (store *Store) byIdempotencyKey(ctx context.Context, key string) (Record, string, error) {
	row := store.database.QueryRowContext(ctx, recordQuery+` WHERE idempotency_key = ?`, key)
	record, existingText, err := scanRecord(row)
	return record, existingText, err
}

func scanRecord(row rowScanner) (Record, string, error) {
	var record Record
	var kind string
	var scheduled sql.NullString
	var allDay int
	var captured string
	var idempotencyKey string
	if err := row.Scan(
		&record.ID,
		&record.RawText,
		&kind,
		&record.Title,
		&scheduled,
		&record.ScheduledDate,
		&record.ScheduledTimezone,
		&allDay,
		&record.Place,
		&record.State,
		&captured,
		&idempotencyKey,
	); err != nil {
		return Record{}, "", fmt.Errorf("scan capture: %w", err)
	}
	record.Kind = Kind(kind)
	record.AllDay = allDay == 1
	capturedAt, err := time.Parse(time.RFC3339Nano, captured)
	if err != nil {
		return Record{}, "", fmt.Errorf("parse capture timestamp: %w", err)
	}
	record.CapturedAt = capturedAt
	if scheduled.Valid {
		scheduledAt, err := time.Parse(time.RFC3339Nano, scheduled.String)
		if err != nil {
			return Record{}, "", fmt.Errorf("parse scheduled timestamp: %w", err)
		}
		record.ScheduledAt = &scheduledAt
	}
	return record, record.RawText, nil
}

func nullableTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
