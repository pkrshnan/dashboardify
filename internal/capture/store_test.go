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
	service := NewService(store, NewParser(location), func() time.Time { return now }, nil)
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
	records, err := NewService(reopened, NewParser(location), func() time.Time { return now }, nil).List(context.Background(), 10)
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
	if _, err := database.Exec(schemaV2); err != nil {
		t.Fatalf("apply all-day legacy migration: %v", err)
	}
	appliedAt := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := database.Exec(
		`INSERT INTO schema_migrations(version, applied_at_utc) VALUES(1, ?), (2, ?)`,
		appliedAt,
		appliedAt,
	); err != nil {
		t.Fatalf("record legacy migrations: %v", err)
	}
	if _, err := database.Exec(`
INSERT INTO captures(
    id, idempotency_key, raw_text, captured_at_utc, interpreted_timezone,
    resolution_state, kind, title, scheduled_at_utc, place, scheduled_date_local, all_day
)
VALUES(
    'legacy-capture', 'legacy-key', 'Remind me to renew passport',
    '2026-09-22T17:00:00Z', 'America/Los_Angeles', 'resolved', 'reminder',
    'renew passport', '2026-09-23T02:00:00Z', 'home', '', 0
);
INSERT INTO tasks(
    id, capture_id, title, remind_at_utc, timezone, place, status,
    created_at_utc, due_date_local, all_day
)
VALUES(
    'legacy-task', 'legacy-capture', 'renew passport', '2026-09-23T02:00:00Z',
    'America/Los_Angeles', 'home', 'open', '2026-09-22T17:00:00Z', '', 0
);`); err != nil {
		t.Fatalf("seed populated legacy database: %v", err)
	}
	if err := database.Close(); err != nil {
		t.Fatalf("close legacy database: %v", err)
	}

	store, err := OpenStore(path)
	if err != nil {
		t.Fatalf("OpenStore() migration error = %v", err)
	}
	defer store.Close()
	legacyTask, err := store.TaskByID(context.Background(), "legacy-task")
	if err != nil {
		t.Fatalf("read migrated legacy task: %v", err)
	}
	if legacyTask.CaptureID != "legacy-capture" || legacyTask.DueAt == nil || legacyTask.Place != "home" {
		t.Fatalf("migrated legacy task = %#v", legacyTask)
	}
	var foreignKeyViolations int
	if err := store.database.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_check`).Scan(&foreignKeyViolations); err != nil {
		t.Fatalf("check migrated foreign keys: %v", err)
	}
	if foreignKeyViolations != 0 {
		t.Fatalf("foreign key violations after migration = %d", foreignKeyViolations)
	}
	location := mustLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.September, 22, 10, 0, 0, 0, location)
	record, err := NewService(store, NewParser(location), func() time.Time { return now }, nil).Create(
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
	if version != 8 {
		t.Fatalf("schema version = %d, want 8", version)
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
	service := NewService(store, NewParser(location), func() time.Time { return now }, nil)

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
	service := NewService(store, NewParser(location), func() time.Time { return now }, nil)
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

func TestEventTimeRangePersistsThroughCaptureClassification(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "dashboardify.db"))
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()
	location := mustLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.September, 28, 10, 0, 0, 0, location)
	service := NewService(store, NewParser(location), func() time.Time { return now }, nil)

	record, err := service.Create(
		context.Background(),
		"ranged-event",
		"Visit Sergiu from 6pm to 8pm on Wednesday at aparment",
	)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if record.ScheduledEndAt == nil || record.DisplayWhen != "Wed, Sep 30 · 6:00 PM–8:00 PM" {
		t.Fatalf("capture record = %#v", record)
	}

	view, err := service.Today(context.Background(), "2026-09-30")
	if err != nil {
		t.Fatalf("Today() error = %v", err)
	}
	if len(view.Events) != 1 || view.Events[0].EndAt == nil ||
		view.Events[0].Place != "aparment" || view.Events[0].Title != "Visit Sergiu" {
		t.Fatalf("events = %#v", view.Events)
	}

	detail, err := service.Detail(context.Background(), record.ID)
	if err != nil {
		t.Fatalf("Detail() error = %v", err)
	}
	if len(detail.History) != 1 || detail.History[0].ScheduledEndAt == nil {
		t.Fatalf("classification history = %#v", detail.History)
	}
}

func TestMultiDayAndRecurringEventsAppearOnApplicableDays(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "dashboardify.db"))
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()
	location := mustLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.September, 30, 10, 0, 0, 0, location)
	service := NewService(store, NewParser(location), func() time.Time { return now }, nil)

	vacation, err := service.Create(context.Background(), "vacation-range", "Vacation October 10 through October 17")
	if err != nil {
		t.Fatalf("create vacation: %v", err)
	}
	if vacation.ScheduledDate != "2026-10-10" || vacation.ScheduledEndDate != "2026-10-18" {
		t.Fatalf("vacation = %#v", vacation)
	}
	recurring, err := service.Create(context.Background(), "weekly-event", "D&D every Wednesday from 7pm to 10pm")
	if err != nil {
		t.Fatalf("create recurring event: %v", err)
	}
	if recurring.RecurrenceRule != "FREQ=WEEKLY;BYDAY=WE" {
		t.Fatalf("recurring = %#v", recurring)
	}

	vacationDay, err := service.Today(context.Background(), "2026-10-15")
	if err != nil || len(vacationDay.Events) != 1 || vacationDay.Events[0].Title != "Vacation" {
		t.Fatalf("vacation day = %#v, %v", vacationDay.Events, err)
	}
	nextWednesday, err := service.Today(context.Background(), "2026-10-07")
	if err != nil || len(nextWednesday.Events) != 1 {
		t.Fatalf("next Wednesday = %#v, %v", nextWednesday.Events, err)
	}
	event := nextWednesday.Events[0]
	if event.Title != "D&D" || event.StartAt == nil || event.EndAt == nil ||
		event.StartAt.In(location).Hour() != 19 || event.EndAt.In(location).Hour() != 22 {
		t.Fatalf("recurring occurrence = %#v", event)
	}
}

func TestRelativeReminderSchedulesItsNotification(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "dashboardify.db"))
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()
	location := mustLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.September, 30, 10, 0, 0, 0, location)
	service := NewService(store, NewParser(location), func() time.Time { return now }, nil)

	if _, err := service.Create(context.Background(), "relative-reminder", "Remind me in 20 minutes to check the oven"); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	view, err := service.Today(context.Background(), "2026-09-30")
	if err != nil || len(view.Tasks) != 1 {
		t.Fatalf("Today() = %#v, %v", view.Tasks, err)
	}
	task := view.Tasks[0]
	if task.DueAt == nil || task.ReminderAt == nil || !task.ReminderAt.Equal(*task.DueAt) {
		t.Fatalf("relative reminder task = %#v", task)
	}
}

func TestDueNotificationQueuePersistsAndDeduplicatesFallback(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "dashboardify.db"))
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()
	location := mustLocation(t, "America/Los_Angeles")
	now := time.Date(2026, time.January, 7, 9, 0, 0, 0, location)
	service := NewService(store, NewParser(location), func() time.Time { return now }, nil)
	if _, err := service.Create(context.Background(), "notification-task", "Remind me to submit report today at 2:30 pm"); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	view, err := service.Today(context.Background(), "2026-01-07")
	if err != nil || len(view.Tasks) != 1 {
		t.Fatalf("Today() = %#v, %v", view, err)
	}
	task := view.Tasks[0]
	reminderAt := now.Add(-time.Minute)
	if _, err := service.UpdateTask(context.Background(), task.ID, TaskUpdate{
		Title:      task.Title,
		DueAt:      task.DueAt,
		DueDate:    task.DueDate,
		ReminderAt: &reminderAt,
		AllDay:     task.AllDay,
		Place:      task.Place,
		Status:     "open",
	}); err != nil {
		t.Fatalf("UpdateTask() error = %v", err)
	}
	for attempt := range 2 {
		notifications, err := service.Notifications(context.Background())
		if err != nil || len(notifications) != 1 {
			t.Fatalf("Notifications() attempt %d = %#v, %v", attempt, notifications, err)
		}
		if attempt == 1 {
			if err := service.DismissNotification(context.Background(), notifications[0].ID); err != nil {
				t.Fatalf("DismissNotification() error = %v", err)
			}
		}
	}
	notifications, err := service.Notifications(context.Background())
	if err != nil || len(notifications) != 0 {
		t.Fatalf("Notifications() after dismissal = %#v, %v", notifications, err)
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
	service := NewService(store, NewParser(location), func() time.Time { return now }, nil)

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
