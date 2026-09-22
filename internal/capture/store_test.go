package capture

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestServicePersistsTypedCapturesAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dashboardify.db")
	location := mustLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.September, 22, 10, 0, 0, 0, location)

	store, err := OpenStore(path)
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	service := NewService(store, NewParser(location), func() time.Time { return now })
	inputs := []struct {
		key  string
		text string
		kind Kind
	}{
		{"capture-reminder", "Remind me to submit report at 2:30 on Wednesday at the office", KindReminder},
		{"capture-all-day", "Remind me to file taxes on Wednesday", KindReminder},
		{"capture-event", "Baseball @ 2:30 on Wednesday", KindEvent},
		{"capture-note", "The locksmith code changed last week", KindNote},
		{"capture-fact", "Sam likes Ethiopian food", KindFact},
		{"capture-activity", "I gymmed today", KindActivity},
	}
	for _, input := range inputs {
		record, err := service.Create(context.Background(), input.key, input.text)
		if err != nil {
			t.Fatalf("Create(%q) error = %v", input.text, err)
		}
		if record.Kind != input.kind || record.State != "resolved" {
			t.Fatalf("Create(%q) = %#v, want resolved %s", input.text, record, input.kind)
		}
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	defer reopened.Close()
	records, err := NewService(reopened, NewParser(location), func() time.Time { return now }).List(context.Background(), 10)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(records) != len(inputs) {
		t.Fatalf("List() returned %d records, want %d", len(records), len(inputs))
	}
	for table, want := range map[string]int{"tasks": 2, "events": 1, "notes": 1, "facts": 1, "activities": 1} {
		var got int
		if err := reopened.database.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&got); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if got != want {
			t.Fatalf("%s count = %d, want %d", table, got, want)
		}
	}
}

func TestOpenStoreMigratesExistingCaptureDatabaseForAllDayRecords(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dashboardify.db")
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy database: %v", err)
	}
	if _, err := database.Exec(schemaV1); err != nil {
		t.Fatalf("apply legacy schema: %v", err)
	}
	if _, err := database.Exec(
		`INSERT INTO schema_migrations(version, applied_at_utc) VALUES(1, ?)`,
		time.Now().UTC().Format(time.RFC3339Nano),
	); err != nil {
		t.Fatalf("record legacy migration: %v", err)
	}
	if err := database.Close(); err != nil {
		t.Fatalf("close legacy database: %v", err)
	}

	store, err := OpenStore(path)
	if err != nil {
		t.Fatalf("OpenStore() migration error = %v", err)
	}
	defer store.Close()
	location := mustLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.September, 22, 10, 0, 0, 0, location)
	record, err := NewService(store, NewParser(location), func() time.Time { return now }).Create(
		context.Background(),
		"all-day-after-migration",
		"Remind me to file taxes on Wednesday",
	)
	if err != nil {
		t.Fatalf("create all-day reminder after migration: %v", err)
	}
	if !record.AllDay || record.ScheduledDate != "2026-09-23" || record.DisplayWhen != "Wed, Sep 23 · all day" {
		t.Fatalf("all-day record = %#v", record)
	}
	var version int
	if err := store.database.QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&version); err != nil {
		t.Fatalf("read migrated schema version: %v", err)
	}
	if version != 4 {
		t.Fatalf("schema version = %d, want 4", version)
	}
}

func TestInboxFilingReclassifiesWithoutChangingOriginalCapture(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "dashboardify.db"))
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()
	location := mustLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.September, 22, 10, 0, 0, 0, location)
	service := NewService(store, NewParser(location), func() time.Time { return now })

	created, err := service.Create(context.Background(), "ambiguous-capture", "Jordan brought cardamom coffee")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.Kind != KindNote || created.InboxState != "open" {
		t.Fatalf("created capture = %#v, want open Inbox note", created)
	}
	inbox, err := service.Inbox(context.Background(), 10)
	if err != nil || len(inbox) != 1 || inbox[0].ID != created.ID {
		t.Fatalf("Inbox() = %#v, %v", inbox, err)
	}

	filed, err := service.File(context.Background(), created.ID, Proposal{
		Kind:    KindFact,
		Subject: "Jordan",
		Title:   "brought cardamom coffee",
	})
	if err != nil {
		t.Fatalf("File() error = %v", err)
	}
	if filed.RawText != created.RawText || filed.Kind != KindFact || filed.InboxState != "filed" {
		t.Fatalf("filed capture = %#v", filed)
	}
	inbox, err = service.Inbox(context.Background(), 10)
	if err != nil || len(inbox) != 0 {
		t.Fatalf("Inbox() after filing = %#v, %v", inbox, err)
	}
	detail, err := service.Detail(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("Detail() error = %v", err)
	}
	if len(detail.History) != 2 || detail.History[0].Kind != KindFact || detail.History[1].Kind != KindNote {
		t.Fatalf("classification history = %#v", detail.History)
	}
}

func TestTodayTaskLifecyclePersistsCompletionAndDeferral(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "dashboardify.db"))
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()
	location := mustLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.January, 5, 10, 0, 0, 0, location)
	service := NewService(store, NewParser(location), func() time.Time { return now })
	for _, input := range []struct {
		key  string
		text string
	}{
		{"today-timed", "Remind me to submit report at 2:30 on Wednesday at the office"},
		{"today-all-day", "Remind me to file taxes on Wednesday"},
		{"today-event", "Baseball @ 2:30 on Wednesday"},
	} {
		if _, err := service.Create(context.Background(), input.key, input.text); err != nil {
			t.Fatalf("Create(%q) error = %v", input.text, err)
		}
	}

	now = time.Date(2026, time.January, 7, 9, 0, 0, 0, location)
	view, err := service.Today(context.Background(), "2026-01-07")
	if err != nil {
		t.Fatalf("Today() error = %v", err)
	}
	if len(view.Tasks) != 2 || len(view.Events) != 1 {
		t.Fatalf("Today() = %d tasks, %d events; want 2 tasks, 1 event", len(view.Tasks), len(view.Events))
	}

	var timed, allDay TaskRecord
	for _, task := range view.Tasks {
		if task.DueAt != nil {
			timed = task
		} else {
			allDay = task
		}
	}
	completed, err := service.UpdateTask(context.Background(), timed.ID, TaskUpdate{
		Title:             timed.Title,
		DueAt:             timed.DueAt,
		DueDate:           timed.DueDate,
		ReminderAt:        timed.ReminderAt,
		AllDay:            timed.AllDay,
		Place:             timed.Place,
		Status:            "completed",
		DeferredUntilDate: timed.DeferredUntilDate,
	})
	if err != nil || completed.CompletedAt == nil {
		t.Fatalf("complete task = %#v, %v", completed, err)
	}
	deferred, err := service.UpdateTask(context.Background(), allDay.ID, TaskUpdate{
		Title:             allDay.Title,
		DueAt:             allDay.DueAt,
		DueDate:           allDay.DueDate,
		ReminderAt:        allDay.ReminderAt,
		AllDay:            allDay.AllDay,
		Place:             allDay.Place,
		Status:            "open",
		DeferredUntilDate: "2026-01-08",
	})
	if err != nil || deferred.DeferredUntilDate != "2026-01-08" {
		t.Fatalf("defer task = %#v, %v", deferred, err)
	}

	view, err = service.Today(context.Background(), "2026-01-07")
	if err != nil {
		t.Fatalf("Today() after actions error = %v", err)
	}
	if len(view.Tasks) != 1 || view.Tasks[0].Status != "completed" {
		t.Fatalf("Today() after actions tasks = %#v", view.Tasks)
	}
	nextDay, err := service.Today(context.Background(), "2026-01-08")
	if err != nil {
		t.Fatalf("Today(next day) error = %v", err)
	}
	if len(nextDay.Tasks) != 1 || nextDay.Tasks[0].ID != allDay.ID {
		t.Fatalf("Today(next day) tasks = %#v", nextDay.Tasks)
	}
}

func TestServiceDeduplicatesRetriedCapture(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "dashboardify.db"))
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()
	location := mustLocation(t, "UTC")
	now := time.Date(2026, time.September, 22, 12, 0, 0, 0, location)
	service := NewService(store, NewParser(location), func() time.Time { return now })

	first, err := service.Create(context.Background(), "same-request", "A durable note")
	if err != nil {
		t.Fatalf("first Create() error = %v", err)
	}
	second, err := service.Create(context.Background(), "same-request", "A durable note")
	if err != nil {
		t.Fatalf("retry Create() error = %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("retry created %q, want original %q", second.ID, first.ID)
	}
	records, err := service.List(context.Background(), 10)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("List() returned %d records, want 1", len(records))
	}

	_, err = service.Create(context.Background(), "same-request", "Different text")
	if !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("conflicting Create() error = %v, want ErrIdempotencyConflict", err)
	}
}
