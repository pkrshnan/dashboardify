package calendar

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

const calendarSchemaV1 = `
CREATE TABLE IF NOT EXISTS calendar_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at_utc TEXT NOT NULL
);

CREATE TABLE calendar_integrations (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK (provider = 'apple_caldav'),
    endpoint TEXT NOT NULL,
    principal_path TEXT NOT NULL DEFAULT '',
    home_set_path TEXT NOT NULL DEFAULT '',
    calendar_path TEXT NOT NULL DEFAULT '',
    calendar_name TEXT NOT NULL,
    sync_token TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'configured' CHECK (state IN ('configured', 'discovered', 'syncing', 'ready', 'error')),
    last_attempt_at_utc TEXT,
    last_success_at_utc TEXT,
    last_error TEXT NOT NULL DEFAULT '',
    created_at_utc TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL
);

CREATE TABLE calendar_objects (
    id TEXT PRIMARY KEY,
    integration_id TEXT NOT NULL REFERENCES calendar_integrations(id) ON DELETE CASCADE,
    remote_path TEXT NOT NULL,
    etag TEXT NOT NULL DEFAULT '',
    uid TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    deleted_at_utc TEXT,
    created_at_utc TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    UNIQUE(integration_id, remote_path)
);

CREATE TABLE calendar_event_links (
    local_event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    integration_id TEXT NOT NULL REFERENCES calendar_integrations(id) ON DELETE CASCADE,
    remote_path TEXT NOT NULL,
    remote_uid TEXT NOT NULL,
    etag TEXT NOT NULL DEFAULT '',
    last_local_hash TEXT NOT NULL DEFAULT '',
    last_remote_hash TEXT NOT NULL DEFAULT '',
    conflict_state TEXT NOT NULL DEFAULT '',
    pending_remote_payload TEXT NOT NULL DEFAULT '',
    remote_deleted INTEGER NOT NULL DEFAULT 0 CHECK (remote_deleted IN (0, 1)),
    created_at_utc TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    UNIQUE(integration_id, remote_path)
);

CREATE TABLE calendar_sync_runs (
    id TEXT PRIMARY KEY,
    integration_id TEXT NOT NULL REFERENCES calendar_integrations(id) ON DELETE CASCADE,
    started_at_utc TEXT NOT NULL,
    finished_at_utc TEXT,
    pulled INTEGER NOT NULL DEFAULT 0,
    pushed INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    conflicts INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX calendar_objects_active_idx
ON calendar_objects(integration_id, deleted_at_utc, updated_at_utc);
CREATE INDEX calendar_links_conflict_idx
ON calendar_event_links(integration_id, conflict_state, updated_at_utc);
CREATE INDEX calendar_sync_runs_started_idx
ON calendar_sync_runs(integration_id, started_at_utc DESC);
`

type Store struct {
	database *sql.DB
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
		return nil, fmt.Errorf("open calendar database: %w", err)
	}
	database.SetMaxOpenConns(1)
	if _, err := database.Exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;`); err != nil {
		_ = database.Close()
		return nil, fmt.Errorf("configure calendar database: %w", err)
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
		return fmt.Errorf("begin calendar migration: %w", err)
	}
	defer transaction.Rollback()
	if _, err := transaction.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS calendar_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at_utc TEXT NOT NULL
)`); err != nil {
		return fmt.Errorf("create calendar migration ledger: %w", err)
	}
	var version int
	if err := transaction.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM calendar_schema_migrations`).Scan(&version); err != nil {
		return fmt.Errorf("read calendar schema version: %w", err)
	}
	if version < 1 {
		if _, err := transaction.ExecContext(ctx, calendarSchemaV1); err != nil {
			return fmt.Errorf("apply calendar schema migration 1: %w", err)
		}
		if _, err := transaction.ExecContext(ctx,
			`INSERT INTO calendar_schema_migrations(version, applied_at_utc) VALUES(1, ?)`,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			return fmt.Errorf("record calendar schema migration 1: %w", err)
		}
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit calendar migration: %w", err)
	}
	return nil
}

func (store *Store) EnsureIntegration(ctx context.Context, cfg Config, now time.Time) error {
	timestamp := now.UTC().Format(time.RFC3339Nano)
	_, err := store.database.ExecContext(ctx, `
INSERT INTO calendar_integrations(
    id, provider, endpoint, calendar_name, state, created_at_utc, updated_at_utc
)
VALUES(?, 'apple_caldav', ?, ?, 'configured', ?, ?)
ON CONFLICT(id) DO UPDATE SET
    principal_path = CASE WHEN endpoint != excluded.endpoint OR calendar_name != excluded.calendar_name THEN '' ELSE principal_path END,
    home_set_path = CASE WHEN endpoint != excluded.endpoint OR calendar_name != excluded.calendar_name THEN '' ELSE home_set_path END,
    calendar_path = CASE WHEN endpoint != excluded.endpoint OR calendar_name != excluded.calendar_name THEN '' ELSE calendar_path END,
    sync_token = CASE WHEN endpoint != excluded.endpoint OR calendar_name != excluded.calendar_name THEN '' ELSE sync_token END,
    state = CASE WHEN endpoint != excluded.endpoint OR calendar_name != excluded.calendar_name THEN 'configured' ELSE state END,
    endpoint = excluded.endpoint,
    calendar_name = excluded.calendar_name,
    updated_at_utc = excluded.updated_at_utc`,
		appleIntegrationID, cfg.Endpoint, cfg.CalendarName, timestamp, timestamp,
	)
	if err != nil {
		return fmt.Errorf("ensure Apple Calendar integration: %w", err)
	}
	return nil
}

func (store *Store) Integration(ctx context.Context) (Integration, error) {
	var integration Integration
	var lastAttempt, lastSuccess sql.NullString
	var updatedAt string
	err := store.database.QueryRowContext(ctx, `
SELECT id, endpoint, principal_path, home_set_path, calendar_path, calendar_name,
       sync_token, state, last_attempt_at_utc, last_success_at_utc, last_error, updated_at_utc
FROM calendar_integrations
WHERE id = ?`, appleIntegrationID).Scan(
		&integration.ID, &integration.Endpoint, &integration.PrincipalPath,
		&integration.HomeSetPath, &integration.CalendarPath, &integration.CalendarName,
		&integration.SyncToken, &integration.State, &lastAttempt, &lastSuccess,
		&integration.LastError, &updatedAt,
	)
	if err != nil {
		return Integration{}, err
	}
	if integration.LastAttemptAt, err = parseOptionalTime(lastAttempt); err != nil {
		return Integration{}, fmt.Errorf("parse calendar last attempt: %w", err)
	}
	if integration.LastSuccessAt, err = parseOptionalTime(lastSuccess); err != nil {
		return Integration{}, fmt.Errorf("parse calendar last success: %w", err)
	}
	if integration.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt); err != nil {
		return Integration{}, fmt.Errorf("parse calendar update time: %w", err)
	}
	return integration, nil
}

func (store *Store) SaveDiscovery(ctx context.Context, discovery Discovery, now time.Time) error {
	result, err := store.database.ExecContext(ctx, `
UPDATE calendar_integrations
SET principal_path = ?, home_set_path = ?, calendar_path = ?, calendar_name = ?,
    sync_token = '', state = 'discovered', last_error = '', updated_at_utc = ?
WHERE id = ?`,
		discovery.PrincipalPath, discovery.HomeSetPath, discovery.Selected.Path,
		discovery.Selected.Name, now.UTC().Format(time.RFC3339Nano), appleIntegrationID,
	)
	if err != nil {
		return fmt.Errorf("save calendar discovery: %w", err)
	}
	return requireChanged(result)
}

func (store *Store) BeginSync(ctx context.Context, now time.Time) (string, error) {
	runID, err := uuid.NewV7()
	if err != nil {
		return "", fmt.Errorf("generate calendar sync run id: %w", err)
	}
	timestamp := now.UTC().Format(time.RFC3339Nano)
	transaction, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin calendar sync state: %w", err)
	}
	defer transaction.Rollback()
	if _, err := transaction.ExecContext(ctx, `
UPDATE calendar_integrations
SET state = 'syncing', last_attempt_at_utc = ?, last_error = '', updated_at_utc = ?
WHERE id = ?`, timestamp, timestamp, appleIntegrationID); err != nil {
		return "", fmt.Errorf("mark calendar sync started: %w", err)
	}
	if _, err := transaction.ExecContext(ctx, `
INSERT INTO calendar_sync_runs(id, integration_id, started_at_utc)
VALUES(?, ?, ?)`, runID.String(), appleIntegrationID, timestamp); err != nil {
		return "", fmt.Errorf("insert calendar sync run: %w", err)
	}
	if err := transaction.Commit(); err != nil {
		return "", fmt.Errorf("commit calendar sync start: %w", err)
	}
	return runID.String(), nil
}

func (store *Store) FinishSync(ctx context.Context, runID, syncToken string, summary SyncSummary, syncErr error) error {
	finishedAt := summary.SyncedAt.UTC().Format(time.RFC3339Nano)
	state := "ready"
	errorText := ""
	var lastSuccess any = finishedAt
	if syncErr != nil {
		state = "error"
		errorText = syncErr.Error()
		lastSuccess = nil
	}
	transaction, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin calendar sync finish: %w", err)
	}
	defer transaction.Rollback()
	if _, err := transaction.ExecContext(ctx, `
UPDATE calendar_integrations
SET sync_token = CASE WHEN ? = '' THEN sync_token ELSE ? END,
    state = ?, last_success_at_utc = COALESCE(?, last_success_at_utc),
    last_error = ?, updated_at_utc = ?
WHERE id = ?`, syncToken, syncToken, state, lastSuccess, errorText, finishedAt, appleIntegrationID); err != nil {
		return fmt.Errorf("finish calendar integration sync: %w", err)
	}
	if _, err := transaction.ExecContext(ctx, `
UPDATE calendar_sync_runs
SET finished_at_utc = ?, pulled = ?, pushed = ?, deleted = ?, conflicts = ?, error = ?
WHERE id = ?`, finishedAt, summary.Pulled, summary.Pushed, summary.Deleted, summary.Conflicts, errorText, runID); err != nil {
		return fmt.Errorf("finish calendar sync run: %w", err)
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit calendar sync finish: %w", err)
	}
	return nil
}

func (store *Store) UpsertRemoteObject(ctx context.Context, object RemoteObject, now time.Time) error {
	id, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate calendar object id: %w", err)
	}
	timestamp := now.UTC().Format(time.RFC3339Nano)
	_, err = store.database.ExecContext(ctx, `
INSERT INTO calendar_objects(
    id, integration_id, remote_path, etag, uid, payload, payload_hash,
    created_at_utc, updated_at_utc
)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(integration_id, remote_path) DO UPDATE SET
    etag = excluded.etag,
    uid = excluded.uid,
    payload = excluded.payload,
    payload_hash = excluded.payload_hash,
    deleted_at_utc = NULL,
    updated_at_utc = excluded.updated_at_utc`,
		id.String(), appleIntegrationID, object.Path, object.ETag, object.UID,
		object.Payload, object.PayloadHash, timestamp, timestamp,
	)
	if err != nil {
		return fmt.Errorf("upsert remote calendar object: %w", err)
	}
	return nil
}

func (store *Store) MarkRemoteDeleted(ctx context.Context, path string, now time.Time) error {
	timestamp := now.UTC().Format(time.RFC3339Nano)
	_, err := store.database.ExecContext(ctx, `
UPDATE calendar_objects
SET deleted_at_utc = ?, updated_at_utc = ?
WHERE integration_id = ? AND remote_path = ?`, timestamp, timestamp, appleIntegrationID, path)
	if err != nil {
		return fmt.Errorf("mark remote calendar object deleted: %w", err)
	}
	return nil
}

func (store *Store) RemoteObjectByPath(ctx context.Context, path string) (RemoteObject, error) {
	return scanRemoteObject(store.database.QueryRowContext(ctx, `
SELECT remote_path, etag, uid, payload, payload_hash, deleted_at_utc, updated_at_utc
FROM calendar_objects
WHERE integration_id = ? AND remote_path = ?`, appleIntegrationID, path))
}

func (store *Store) ActiveRemoteObjects(ctx context.Context) ([]RemoteObject, error) {
	rows, err := store.database.QueryContext(ctx, `
SELECT remote_path, etag, uid, payload, payload_hash, deleted_at_utc, updated_at_utc
FROM calendar_objects
WHERE integration_id = ? AND deleted_at_utc IS NULL`, appleIntegrationID)
	if err != nil {
		return nil, fmt.Errorf("list active remote calendar objects: %w", err)
	}
	defer rows.Close()
	objects := make([]RemoteObject, 0, 64)
	for rows.Next() {
		object, err := scanRemoteObject(rows)
		if err != nil {
			return nil, err
		}
		objects = append(objects, object)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active remote calendar objects: %w", err)
	}
	return objects, nil
}

func (store *Store) ListAgendaObjects(ctx context.Context) ([]RemoteObject, error) {
	rows, err := store.database.QueryContext(ctx, `
SELECT objects.remote_path, objects.etag, objects.uid, objects.payload, objects.payload_hash,
       objects.deleted_at_utc, objects.updated_at_utc
FROM calendar_objects AS objects
LEFT JOIN calendar_event_links AS links
  ON links.integration_id = objects.integration_id
 AND links.remote_path = objects.remote_path
WHERE objects.integration_id = ?
  AND objects.deleted_at_utc IS NULL
  AND links.local_event_id IS NULL
ORDER BY objects.updated_at_utc DESC
LIMIT 1000`, appleIntegrationID)
	if err != nil {
		return nil, fmt.Errorf("list calendar agenda objects: %w", err)
	}
	defer rows.Close()
	objects := make([]RemoteObject, 0, 64)
	for rows.Next() {
		object, err := scanRemoteObject(rows)
		if err != nil {
			return nil, err
		}
		objects = append(objects, object)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate calendar agenda objects: %w", err)
	}
	return objects, nil
}

func (store *Store) NativeEvents(ctx context.Context) ([]NativeEvent, error) {
	rows, err := store.database.QueryContext(ctx, nativeEventQuery+` ORDER BY events.created_at_utc LIMIT 1000`)
	if err != nil {
		return nil, fmt.Errorf("list native calendar events: %w", err)
	}
	defer rows.Close()
	events := make([]NativeEvent, 0, 32)
	for rows.Next() {
		event, err := scanNativeEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate native calendar events: %w", err)
	}
	return events, nil
}

func (store *Store) NativeEventByID(ctx context.Context, id string) (NativeEvent, error) {
	return scanNativeEvent(store.database.QueryRowContext(ctx, nativeEventQuery+` WHERE events.id = ?`, id))
}

func (store *Store) UpdateNativeEvent(ctx context.Context, event NativeEvent, now time.Time) error {
	result, err := store.database.ExecContext(ctx, `
UPDATE events
SET title = ?, start_at_utc = ?, end_at_utc = ?, start_date_local = ?,
    end_date_local = ?, all_day = ?, timezone = ?, place = ?, recurrence_rule = ?,
    status = ?, updated_at_utc = ?
WHERE id = ?`,
		event.Title, nullableTime(event.StartAt), nullableTime(event.EndAt), event.StartDate,
		event.EndDate, boolInt(event.AllDay), event.Timezone, event.Place, event.RecurrenceRule, event.Status,
		now.UTC().Format(time.RFC3339Nano), event.ID)
	if err != nil {
		return fmt.Errorf("update native event: %w", err)
	}
	return requireChanged(result)
}

func (store *Store) LinkByRemotePath(ctx context.Context, path string) (EventLink, error) {
	return scanLink(store.database.QueryRowContext(ctx, linkQuery+`
WHERE integration_id = ? AND remote_path = ?`, appleIntegrationID, path))
}

func (store *Store) LinkByLocalID(ctx context.Context, localEventID string) (EventLink, error) {
	return scanLink(store.database.QueryRowContext(ctx, linkQuery+`
WHERE local_event_id = ?`, localEventID))
}

func (store *Store) SaveLink(ctx context.Context, link EventLink, now time.Time) error {
	timestamp := now.UTC().Format(time.RFC3339Nano)
	_, err := store.database.ExecContext(ctx, `
INSERT INTO calendar_event_links(
    local_event_id, integration_id, remote_path, remote_uid, etag,
    last_local_hash, last_remote_hash, conflict_state, pending_remote_payload,
    remote_deleted, created_at_utc, updated_at_utc
)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(local_event_id) DO UPDATE SET
    remote_path = excluded.remote_path,
    remote_uid = excluded.remote_uid,
    etag = excluded.etag,
    last_local_hash = excluded.last_local_hash,
    last_remote_hash = excluded.last_remote_hash,
    conflict_state = excluded.conflict_state,
    pending_remote_payload = excluded.pending_remote_payload,
    remote_deleted = excluded.remote_deleted,
    updated_at_utc = excluded.updated_at_utc`,
		link.LocalEventID, appleIntegrationID, link.RemotePath, link.RemoteUID, link.ETag,
		link.LastLocalHash, link.LastRemoteHash, link.ConflictState, link.PendingRemotePayload,
		boolInt(link.RemoteDeleted), timestamp, timestamp,
	)
	if err != nil {
		return fmt.Errorf("save calendar event link: %w", err)
	}
	return nil
}

func (store *Store) Conflicts(ctx context.Context) ([]Conflict, error) {
	rows, err := store.database.QueryContext(ctx, `
SELECT links.local_event_id, links.remote_path, links.conflict_state, events.title, links.updated_at_utc
FROM calendar_event_links AS links
JOIN events ON events.id = links.local_event_id
WHERE links.integration_id = ? AND links.conflict_state != ''
ORDER BY links.updated_at_utc DESC`, appleIntegrationID)
	if err != nil {
		return nil, fmt.Errorf("list calendar conflicts: %w", err)
	}
	defer rows.Close()
	conflicts := make([]Conflict, 0, 8)
	for rows.Next() {
		var conflict Conflict
		var updatedAt string
		if err := rows.Scan(&conflict.LocalEventID, &conflict.RemotePath, &conflict.Kind, &conflict.Title, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan calendar conflict: %w", err)
		}
		parsed, err := time.Parse(time.RFC3339Nano, updatedAt)
		if err != nil {
			return nil, fmt.Errorf("parse calendar conflict time: %w", err)
		}
		conflict.UpdatedAt = parsed
		conflicts = append(conflicts, conflict)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate calendar conflicts: %w", err)
	}
	return conflicts, nil
}

func (store *Store) ConflictCount(ctx context.Context) (int, error) {
	var count int
	err := store.database.QueryRowContext(ctx, `
SELECT COUNT(*) FROM calendar_event_links
WHERE integration_id = ? AND conflict_state != ''`, appleIntegrationID).Scan(&count)
	return count, err
}

const nativeEventQuery = `
SELECT events.id, events.title, events.start_at_utc, events.end_at_utc,
       events.start_date_local, events.end_date_local, events.all_day,
       events.timezone, events.place, events.recurrence_rule, events.status,
       events.created_at_utc, events.updated_at_utc
FROM events`

const linkQuery = `
SELECT local_event_id, remote_path, remote_uid, etag, last_local_hash,
       last_remote_hash, conflict_state, pending_remote_payload, remote_deleted,
       updated_at_utc
FROM calendar_event_links`

type rowScanner interface {
	Scan(...any) error
}

func scanRemoteObject(row rowScanner) (RemoteObject, error) {
	var object RemoteObject
	var deletedAt sql.NullString
	var updatedAt string
	if err := row.Scan(
		&object.Path, &object.ETag, &object.UID, &object.Payload,
		&object.PayloadHash, &deletedAt, &updatedAt,
	); err != nil {
		return RemoteObject{}, err
	}
	var err error
	if object.DeletedAt, err = parseOptionalTime(deletedAt); err != nil {
		return RemoteObject{}, fmt.Errorf("parse calendar object deletion time: %w", err)
	}
	if object.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt); err != nil {
		return RemoteObject{}, fmt.Errorf("parse calendar object update time: %w", err)
	}
	return object, nil
}

func scanNativeEvent(row rowScanner) (NativeEvent, error) {
	var event NativeEvent
	var startAt, endAt sql.NullString
	var allDay int
	var createdAt, updatedAt string
	if err := row.Scan(
		&event.ID, &event.Title, &startAt, &endAt, &event.StartDate, &event.EndDate,
		&allDay, &event.Timezone, &event.Place, &event.RecurrenceRule, &event.Status,
		&createdAt, &updatedAt,
	); err != nil {
		return NativeEvent{}, err
	}
	event.AllDay = allDay == 1
	var err error
	if event.StartAt, err = parseOptionalTime(startAt); err != nil {
		return NativeEvent{}, fmt.Errorf("parse native event start: %w", err)
	}
	if event.EndAt, err = parseOptionalTime(endAt); err != nil {
		return NativeEvent{}, fmt.Errorf("parse native event end: %w", err)
	}
	if event.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt); err != nil {
		return NativeEvent{}, fmt.Errorf("parse native event creation: %w", err)
	}
	if updatedAt == "" {
		event.UpdatedAt = event.CreatedAt
	} else if event.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt); err != nil {
		return NativeEvent{}, fmt.Errorf("parse native event update: %w", err)
	}
	return event, nil
}

func scanLink(row rowScanner) (EventLink, error) {
	var link EventLink
	var remoteDeleted int
	var updatedAt string
	if err := row.Scan(
		&link.LocalEventID, &link.RemotePath, &link.RemoteUID, &link.ETag,
		&link.LastLocalHash, &link.LastRemoteHash, &link.ConflictState,
		&link.PendingRemotePayload, &remoteDeleted, &updatedAt,
	); err != nil {
		return EventLink{}, err
	}
	link.RemoteDeleted = remoteDeleted == 1
	parsed, err := time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return EventLink{}, fmt.Errorf("parse calendar link update: %w", err)
	}
	link.UpdatedAt = parsed
	return link, nil
}

func parseOptionalTime(value sql.NullString) (*time.Time, error) {
	if !value.Valid || value.String == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value.String)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
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

func requireChanged(result sql.Result) error {
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return sql.ErrNoRows
	}
	return nil
}
