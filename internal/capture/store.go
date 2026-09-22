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
	Subject           string     `json:"subject,omitempty"`
	ScheduledAt       *time.Time `json:"scheduled_at,omitempty"`
	ScheduledDate     string     `json:"scheduled_date,omitempty"`
	OccurredDate      string     `json:"occurred_date,omitempty"`
	ScheduledTimezone string     `json:"scheduled_timezone,omitempty"`
	AllDay            bool       `json:"all_day,omitempty"`
	DisplayWhen       string     `json:"display_when,omitempty"`
	Place             string     `json:"place,omitempty"`
	State             string     `json:"state"`
	InboxState        string     `json:"inbox_state"`
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

const schemaV3 = `
PRAGMA defer_foreign_keys = ON;

CREATE TABLE captures_next (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    raw_text TEXT NOT NULL,
    captured_at_utc TEXT NOT NULL,
    interpreted_timezone TEXT NOT NULL,
    resolution_state TEXT NOT NULL CHECK (resolution_state IN ('pending', 'resolved')),
    inbox_state TEXT NOT NULL DEFAULT 'filed' CHECK (inbox_state IN ('open', 'filed')),
    kind TEXT NOT NULL CHECK (kind IN ('pending', 'reminder', 'event', 'note', 'fact', 'activity')),
    title TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    scheduled_at_utc TEXT,
    scheduled_date_local TEXT NOT NULL DEFAULT '',
    occurred_date_local TEXT NOT NULL DEFAULT '',
    all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
    place TEXT NOT NULL DEFAULT '',
    updated_at_utc TEXT NOT NULL
);

INSERT INTO captures_next(
    id, idempotency_key, raw_text, captured_at_utc, interpreted_timezone,
    resolution_state, inbox_state, kind, title, scheduled_at_utc,
    scheduled_date_local, all_day, place, updated_at_utc
)
SELECT
    id, idempotency_key, raw_text, captured_at_utc, interpreted_timezone,
    resolution_state, 'filed', kind, title, scheduled_at_utc,
    scheduled_date_local, all_day, place, captured_at_utc
FROM captures;

DROP TABLE captures;
ALTER TABLE captures_next RENAME TO captures;

CREATE INDEX captures_captured_at_idx ON captures(captured_at_utc DESC);
CREATE INDEX captures_inbox_idx ON captures(inbox_state, captured_at_utc DESC);

ALTER TABLE tasks ADD COLUMN completed_at_utc TEXT;
ALTER TABLE tasks ADD COLUMN deferred_until_date_local TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN updated_at_utc TEXT NOT NULL DEFAULT '';

CREATE TABLE facts (
    id TEXT PRIMARY KEY,
    capture_id TEXT NOT NULL UNIQUE REFERENCES captures(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    statement TEXT NOT NULL,
    created_at_utc TEXT NOT NULL
);

CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    capture_id TEXT NOT NULL UNIQUE REFERENCES captures(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    occurred_date_local TEXT NOT NULL,
    timezone TEXT NOT NULL,
    created_at_utc TEXT NOT NULL
);

CREATE TABLE capture_classifications (
    id TEXT PRIMARY KEY,
    capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    scheduled_at_utc TEXT,
    scheduled_date_local TEXT NOT NULL DEFAULT '',
    occurred_date_local TEXT NOT NULL DEFAULT '',
    all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
    place TEXT NOT NULL DEFAULT '',
    classified_at_utc TEXT NOT NULL
);

CREATE INDEX capture_classifications_capture_idx
ON capture_classifications(capture_id, classified_at_utc DESC);
`

const schemaV4 = `
ALTER TABLE tasks RENAME COLUMN remind_at_utc TO due_at_utc;
ALTER TABLE tasks ADD COLUMN reminder_at_utc TEXT;
CREATE INDEX tasks_agenda_idx ON tasks(status, due_date_local, due_at_utc);
CREATE INDEX tasks_deferred_idx ON tasks(status, deferred_until_date_local);
CREATE INDEX events_agenda_idx ON events(start_date_local, start_at_utc);
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
	for index, migration := range []string{schemaV1, schemaV2, schemaV3, schemaV4} {
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
INSERT INTO captures(
    id, idempotency_key, raw_text, captured_at_utc, interpreted_timezone,
    resolution_state, inbox_state, kind, updated_at_utc
)
VALUES(?, ?, ?, ?, ?, 'pending', 'open', 'pending', ?)
ON CONFLICT(idempotency_key) DO NOTHING`,
		id.String(), key, rawText, capturedAt.UTC().Format(time.RFC3339Nano), timezone,
		capturedAt.UTC().Format(time.RFC3339Nano),
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
		InboxState: "open",
		CapturedAt: capturedAt.UTC(),
	}, true, nil
}

func (store *Store) Resolve(ctx context.Context, captureID string, proposal Proposal, inboxState string, resolvedAt time.Time) error {
	transaction, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin capture resolution: %w", err)
	}
	defer transaction.Rollback()

	var exists int
	if err := transaction.QueryRowContext(ctx, `SELECT 1 FROM captures WHERE id = ?`, captureID).Scan(&exists); err != nil {
		return fmt.Errorf("read capture: %w", err)
	}
	for _, table := range []string{"tasks", "events", "notes", "facts", "activities"} {
		if _, err := transaction.ExecContext(ctx, `DELETE FROM `+table+` WHERE capture_id = ?`, captureID); err != nil {
			return fmt.Errorf("remove prior %s classification: %w", table, err)
		}
	}

	recordID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate record id: %w", err)
	}
	when := nullableTime(proposal.ScheduledAt)
	allDay := boolInt(proposal.AllDay)
	classifiedAt := resolvedAt.UTC().Format(time.RFC3339Nano)
	switch proposal.Kind {
	case KindReminder:
		_, err = transaction.ExecContext(ctx, `
INSERT INTO tasks(
    id, capture_id, title, due_at_utc, due_date_local, all_day,
    timezone, place, created_at_utc, updated_at_utc
)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			recordID.String(), captureID, proposal.Title, when, proposal.ScheduledDate, allDay,
			proposal.ScheduledTimezone, proposal.Place, classifiedAt, classifiedAt)
	case KindEvent:
		_, err = transaction.ExecContext(ctx, `
INSERT INTO events(id, capture_id, title, start_at_utc, start_date_local, all_day, timezone, place, created_at_utc)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			recordID.String(), captureID, proposal.Title, when, proposal.ScheduledDate, allDay,
			proposal.ScheduledTimezone, proposal.Place, classifiedAt)
	case KindNote:
		_, err = transaction.ExecContext(ctx, `
INSERT INTO notes(id, capture_id, body, created_at_utc)
VALUES(?, ?, ?, ?)`, recordID.String(), captureID, proposal.Title, classifiedAt)
	case KindFact:
		_, err = transaction.ExecContext(ctx, `
INSERT INTO facts(id, capture_id, subject, statement, created_at_utc)
VALUES(?, ?, ?, ?, ?)`, recordID.String(), captureID, proposal.Subject, proposal.Title, classifiedAt)
	case KindActivity:
		_, err = transaction.ExecContext(ctx, `
INSERT INTO activities(id, capture_id, title, occurred_date_local, timezone, created_at_utc)
VALUES(?, ?, ?, ?, ?, ?)`,
			recordID.String(), captureID, proposal.Title, proposal.OccurredDate,
			proposal.ScheduledTimezone, classifiedAt)
	default:
		return fmt.Errorf("unsupported capture kind %q", proposal.Kind)
	}
	if err != nil {
		return fmt.Errorf("insert %s record: %w", proposal.Kind, err)
	}

	if _, err := transaction.ExecContext(ctx, `
UPDATE captures
SET resolution_state = 'resolved', inbox_state = ?, kind = ?, title = ?, subject = ?,
    scheduled_at_utc = ?, scheduled_date_local = ?, occurred_date_local = ?,
    all_day = ?, place = ?, updated_at_utc = ?
WHERE id = ?`,
		inboxState, proposal.Kind, proposal.Title, proposal.Subject, when,
		proposal.ScheduledDate, proposal.OccurredDate, allDay, proposal.Place,
		classifiedAt, captureID,
	); err != nil {
		return fmt.Errorf("finish capture resolution: %w", err)
	}

	historyID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate classification history id: %w", err)
	}
	if _, err := transaction.ExecContext(ctx, `
INSERT INTO capture_classifications(
    id, capture_id, kind, title, subject, scheduled_at_utc, scheduled_date_local,
    occurred_date_local, all_day, place, classified_at_utc
)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		historyID.String(), captureID, proposal.Kind, proposal.Title, proposal.Subject,
		when, proposal.ScheduledDate, proposal.OccurredDate, allDay, proposal.Place,
		classifiedAt,
	); err != nil {
		return fmt.Errorf("record classification history: %w", err)
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

func (store *Store) ListInbox(ctx context.Context, limit int) ([]Record, error) {
	rows, err := store.database.QueryContext(
		ctx,
		recordQuery+` WHERE inbox_state = 'open' ORDER BY captured_at_utc DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list inbox captures: %w", err)
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
		return nil, fmt.Errorf("iterate inbox captures: %w", err)
	}
	return records, nil
}

type Classification struct {
	Kind          Kind       `json:"kind"`
	Title         string     `json:"title"`
	Subject       string     `json:"subject,omitempty"`
	ScheduledAt   *time.Time `json:"scheduled_at,omitempty"`
	ScheduledDate string     `json:"scheduled_date,omitempty"`
	OccurredDate  string     `json:"occurred_date,omitempty"`
	AllDay        bool       `json:"all_day,omitempty"`
	Place         string     `json:"place,omitempty"`
	ClassifiedAt  time.Time  `json:"classified_at"`
}

func (store *Store) ClassificationHistory(ctx context.Context, captureID string) ([]Classification, error) {
	rows, err := store.database.QueryContext(ctx, `
SELECT kind, title, subject, scheduled_at_utc, scheduled_date_local,
       occurred_date_local, all_day, place, classified_at_utc
FROM capture_classifications
WHERE capture_id = ?
ORDER BY classified_at_utc DESC, id DESC`, captureID)
	if err != nil {
		return nil, fmt.Errorf("list capture classification history: %w", err)
	}
	defer rows.Close()

	history := make([]Classification, 0, 4)
	for rows.Next() {
		var item Classification
		var kind string
		var scheduled sql.NullString
		var allDay int
		var classified string
		if err := rows.Scan(
			&kind, &item.Title, &item.Subject, &scheduled, &item.ScheduledDate,
			&item.OccurredDate, &allDay, &item.Place, &classified,
		); err != nil {
			return nil, fmt.Errorf("scan capture classification history: %w", err)
		}
		item.Kind = Kind(kind)
		item.AllDay = allDay == 1
		if scheduled.Valid {
			value, err := time.Parse(time.RFC3339Nano, scheduled.String)
			if err != nil {
				return nil, fmt.Errorf("parse classification schedule: %w", err)
			}
			item.ScheduledAt = &value
		}
		value, err := time.Parse(time.RFC3339Nano, classified)
		if err != nil {
			return nil, fmt.Errorf("parse classification timestamp: %w", err)
		}
		item.ClassifiedAt = value
		history = append(history, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate capture classification history: %w", err)
	}
	return history, nil
}

type TaskRecord struct {
	ID                string     `json:"id"`
	CaptureID         string     `json:"capture_id"`
	Title             string     `json:"title"`
	DueAt             *time.Time `json:"due_at,omitempty"`
	DueDate           string     `json:"due_date,omitempty"`
	ReminderAt        *time.Time `json:"reminder_at,omitempty"`
	AllDay            bool       `json:"all_day,omitempty"`
	Timezone          string     `json:"timezone"`
	Place             string     `json:"place,omitempty"`
	Status            string     `json:"status"`
	CompletedAt       *time.Time `json:"completed_at,omitempty"`
	DeferredUntilDate string     `json:"deferred_until_date,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	Overdue           bool       `json:"overdue"`
}

type EventRecord struct {
	ID        string     `json:"id"`
	CaptureID string     `json:"capture_id"`
	Title     string     `json:"title"`
	StartAt   *time.Time `json:"start_at,omitempty"`
	StartDate string     `json:"start_date,omitempty"`
	AllDay    bool       `json:"all_day,omitempty"`
	Timezone  string     `json:"timezone"`
	Place     string     `json:"place,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

type TaskUpdate struct {
	Title             string
	DueAt             *time.Time
	DueDate           string
	ReminderAt        *time.Time
	AllDay            bool
	Place             string
	Status            string
	CompletedAt       *time.Time
	DeferredUntilDate string
}

func (store *Store) TodayRecords(ctx context.Context, date string, start, end time.Time) ([]TaskRecord, []EventRecord, error) {
	taskRows, err := store.database.QueryContext(ctx, taskQuery+`
WHERE (
    status = 'open'
    AND (deferred_until_date_local = '' OR deferred_until_date_local <= ?)
    AND created_at_utc < ?
    AND (
        due_at_utc < ?
        OR due_date_local <= ?
        OR deferred_until_date_local = ?
        OR (due_at_utc IS NULL AND due_date_local = '')
    )
) OR (
    status = 'completed'
    AND completed_at_utc >= ?
    AND completed_at_utc < ?
)
ORDER BY COALESCE(due_at_utc, ''), created_at_utc
LIMIT 300`, date, end.UTC().Format(time.RFC3339Nano), end.UTC().Format(time.RFC3339Nano), date, date,
		start.UTC().Format(time.RFC3339Nano), end.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return nil, nil, fmt.Errorf("list Today tasks: %w", err)
	}
	tasks := make([]TaskRecord, 0, 24)
	for taskRows.Next() {
		task, err := scanTask(taskRows)
		if err != nil {
			taskRows.Close()
			return nil, nil, err
		}
		tasks = append(tasks, task)
	}
	if err := taskRows.Err(); err != nil {
		taskRows.Close()
		return nil, nil, fmt.Errorf("iterate Today tasks: %w", err)
	}
	taskRows.Close()

	eventRows, err := store.database.QueryContext(ctx, eventQuery+`
WHERE (start_at_utc >= ? AND start_at_utc < ?)
   OR (all_day = 1 AND start_date_local = ?)
ORDER BY COALESCE(start_at_utc, ''), created_at_utc
LIMIT 200`, start.UTC().Format(time.RFC3339Nano), end.UTC().Format(time.RFC3339Nano), date)
	if err != nil {
		return nil, nil, fmt.Errorf("list Today events: %w", err)
	}
	defer eventRows.Close()
	events := make([]EventRecord, 0, 16)
	for eventRows.Next() {
		event, err := scanEvent(eventRows)
		if err != nil {
			return nil, nil, err
		}
		events = append(events, event)
	}
	if err := eventRows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate Today events: %w", err)
	}
	return tasks, events, nil
}

func (store *Store) TaskByID(ctx context.Context, id string) (TaskRecord, error) {
	return scanTask(store.database.QueryRowContext(ctx, taskQuery+` WHERE id = ?`, id))
}

func (store *Store) UpdateTask(ctx context.Context, id string, update TaskUpdate, updatedAt time.Time) (TaskRecord, error) {
	result, err := store.database.ExecContext(ctx, `
UPDATE tasks
SET title = ?, due_at_utc = ?, due_date_local = ?, reminder_at_utc = ?,
    all_day = ?, place = ?, status = ?, completed_at_utc = ?,
    deferred_until_date_local = ?, updated_at_utc = ?
WHERE id = ?`,
		update.Title, nullableTime(update.DueAt), update.DueDate, nullableTime(update.ReminderAt),
		boolInt(update.AllDay), update.Place, update.Status, nullableTime(update.CompletedAt),
		update.DeferredUntilDate, updatedAt.UTC().Format(time.RFC3339Nano), id)
	if err != nil {
		return TaskRecord{}, fmt.Errorf("update task: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return TaskRecord{}, fmt.Errorf("inspect task update: %w", err)
	}
	if changed == 0 {
		return TaskRecord{}, sql.ErrNoRows
	}
	return store.TaskByID(ctx, id)
}

const taskQuery = `
SELECT id, capture_id, title, due_at_utc, due_date_local, reminder_at_utc,
       all_day, timezone, place, status, completed_at_utc,
       deferred_until_date_local, created_at_utc, updated_at_utc
FROM tasks`

const eventQuery = `
SELECT id, capture_id, title, start_at_utc, start_date_local, all_day,
       timezone, place, created_at_utc
FROM events`

func scanTask(row rowScanner) (TaskRecord, error) {
	var task TaskRecord
	var dueAt, reminderAt, completedAt sql.NullString
	var allDay int
	var createdAt, updatedAt string
	if err := row.Scan(
		&task.ID, &task.CaptureID, &task.Title, &dueAt, &task.DueDate, &reminderAt,
		&allDay, &task.Timezone, &task.Place, &task.Status, &completedAt,
		&task.DeferredUntilDate, &createdAt, &updatedAt,
	); err != nil {
		return TaskRecord{}, fmt.Errorf("scan task: %w", err)
	}
	task.AllDay = allDay == 1
	var err error
	if task.DueAt, err = parseNullableTime(dueAt); err != nil {
		return TaskRecord{}, fmt.Errorf("parse task due time: %w", err)
	}
	if task.ReminderAt, err = parseNullableTime(reminderAt); err != nil {
		return TaskRecord{}, fmt.Errorf("parse task reminder time: %w", err)
	}
	if task.CompletedAt, err = parseNullableTime(completedAt); err != nil {
		return TaskRecord{}, fmt.Errorf("parse task completion time: %w", err)
	}
	if task.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt); err != nil {
		return TaskRecord{}, fmt.Errorf("parse task creation time: %w", err)
	}
	if updatedAt == "" {
		task.UpdatedAt = task.CreatedAt
	} else if task.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt); err != nil {
		return TaskRecord{}, fmt.Errorf("parse task update time: %w", err)
	}
	return task, nil
}

func scanEvent(row rowScanner) (EventRecord, error) {
	var event EventRecord
	var startAt sql.NullString
	var allDay int
	var createdAt string
	if err := row.Scan(
		&event.ID, &event.CaptureID, &event.Title, &startAt, &event.StartDate,
		&allDay, &event.Timezone, &event.Place, &createdAt,
	); err != nil {
		return EventRecord{}, fmt.Errorf("scan event: %w", err)
	}
	event.AllDay = allDay == 1
	var err error
	if event.StartAt, err = parseNullableTime(startAt); err != nil {
		return EventRecord{}, fmt.Errorf("parse event start time: %w", err)
	}
	if event.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt); err != nil {
		return EventRecord{}, fmt.Errorf("parse event creation time: %w", err)
	}
	return event, nil
}

func parseNullableTime(value sql.NullString) (*time.Time, error) {
	if !value.Valid {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value.String)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

const recordQuery = `
SELECT id, raw_text, kind, title, subject, scheduled_at_utc, scheduled_date_local,
       occurred_date_local, interpreted_timezone, all_day, place, resolution_state,
       inbox_state, captured_at_utc, idempotency_key
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
		&record.Subject,
		&scheduled,
		&record.ScheduledDate,
		&record.OccurredDate,
		&record.ScheduledTimezone,
		&allDay,
		&record.Place,
		&record.State,
		&record.InboxState,
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
