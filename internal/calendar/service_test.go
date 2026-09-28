package calendar

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"dashboardify/internal/capture"
)

type fakeProvider struct {
	discovery Discovery
	objects   map[string]RemoteObject
	puts      int
	deletes   int
}

func (provider *fakeProvider) Discover(context.Context, string) (Discovery, error) {
	return provider.discovery, nil
}

func (provider *fakeProvider) List(context.Context, string) ([]RemoteObject, error) {
	objects := make([]RemoteObject, 0, len(provider.objects))
	for _, object := range provider.objects {
		objects = append(objects, object)
	}
	return objects, nil
}

func (provider *fakeProvider) Put(_ context.Context, path, payload, etag string) (RemoteObject, error) {
	current, exists := provider.objects[path]
	if etag == "" && exists {
		return RemoteObject{}, ErrConflict
	}
	if etag != "" && (!exists || current.ETag != etag) {
		return RemoteObject{}, ErrConflict
	}
	provider.puts++
	object := RemoteObject{
		Path:        path,
		ETag:        "etag-" + time.Now().UTC().Format("150405.000000000"),
		Payload:     payload,
		PayloadHash: hashText(payload),
	}
	parsed, err := decodeNativeEvent(payload, "ignored", time.Time{})
	if err != nil {
		return RemoteObject{}, err
	}
	object.UID = parsed.ID + "@dashboardify"
	provider.objects[path] = object
	return object, nil
}

func (provider *fakeProvider) Delete(_ context.Context, path, etag string) error {
	current, exists := provider.objects[path]
	if !exists {
		return nil
	}
	if current.ETag != etag {
		return ErrConflict
	}
	delete(provider.objects, path)
	provider.deletes++
	return nil
}

func TestSyncPushesNativeEventsAndPullsRemoteChanges(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "dashboardify.db")
	captureStore, err := capture.OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer captureStore.Close()

	createdAt := time.Date(2026, time.July, 7, 9, 0, 0, 0, time.UTC)
	captured, _, err := captureStore.InsertRaw(ctx, "calendar-sync-test", "event: Design review", "America/Los_Angeles", createdAt)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, time.July, 8, 17, 0, 0, 0, time.UTC)
	if err := captureStore.Resolve(ctx, captured.ID, capture.Proposal{
		Kind:              capture.KindEvent,
		Title:             "Design review",
		ScheduledAt:       &start,
		ScheduledTimezone: "America/Los_Angeles",
		Place:             "Studio",
	}, "filed", createdAt); err != nil {
		t.Fatal(err)
	}

	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	provider := &fakeProvider{
		discovery: Discovery{
			PrincipalPath: "/principal/",
			HomeSetPath:   "/calendars/user/",
			Selected:      CalendarChoice{Path: "/calendars/user/dashboardify/", Name: "Dashboardify"},
		},
		objects: make(map[string]RemoteObject),
	}
	service, err := NewService(ctx, Config{
		Enabled: true, Endpoint: "https://caldav.example/", Username: "user",
		Password: "secret", CalendarName: "Dashboardify",
	}, store, provider)
	if err != nil {
		t.Fatal(err)
	}
	clock := createdAt
	service.now = func() time.Time { return clock }

	summary, err := service.Sync(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Pushed != 1 || provider.puts != 1 {
		t.Fatalf("first sync = %+v, puts = %d; want one push", summary, provider.puts)
	}
	events, err := store.NativeEvents(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("native events = %d, want 1", len(events))
	}
	local := events[0]
	link, err := store.LinkByLocalID(ctx, local.ID)
	if err != nil {
		t.Fatal(err)
	}
	remote := provider.objects[link.RemotePath]
	changed := local
	changed.Title = "Design review moved"
	changed.StartAt = timePointer(start.Add(2 * time.Hour))
	payload, err := encodeNativeEvent(changed, clock.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	remote.Payload = payload
	remote.PayloadHash = hashText(payload)
	remote.ETag = "remote-v2"
	provider.objects[link.RemotePath] = remote

	clock = clock.Add(time.Minute)
	summary, err = service.Sync(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Pulled != 1 {
		t.Fatalf("second sync pulled = %d, want 1", summary.Pulled)
	}
	local, err = store.NativeEventByID(ctx, local.ID)
	if err != nil {
		t.Fatal(err)
	}
	if local.Title != "Design review moved" || local.StartAt == nil || !local.StartAt.Equal(start.Add(2*time.Hour)) {
		t.Fatalf("pulled event = %+v", local)
	}
}

func TestSyncUpdatesReclassifiedEventWithoutCreatingDuplicate(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "dashboardify.db")
	captureStore, err := capture.OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer captureStore.Close()
	createdAt := time.Date(2026, time.July, 7, 9, 0, 0, 0, time.UTC)
	captured, _, err := captureStore.InsertRaw(ctx, "calendar-reclassification", "D&D tomorrow at 7pm", "America/Los_Angeles", createdAt)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, time.July, 8, 2, 0, 0, 0, time.UTC)
	proposal := capture.Proposal{
		Kind: capture.KindEvent, Title: "D&D", ScheduledAt: &start, ScheduledTimezone: "America/Los_Angeles",
	}
	if err := captureStore.Resolve(ctx, captured.ID, proposal, "filed", createdAt); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	provider := &fakeProvider{
		discovery: Discovery{
			PrincipalPath: "/principal/", HomeSetPath: "/calendars/user/",
			Selected: CalendarChoice{Path: "/calendars/user/dashboardify/", Name: "Dashboardify"},
		},
		objects: make(map[string]RemoteObject),
	}
	service, err := NewService(ctx, Config{
		Enabled: true, Endpoint: "https://caldav.example/", Username: "user",
		Password: "secret", CalendarName: "Dashboardify",
	}, store, provider)
	if err != nil {
		t.Fatal(err)
	}
	service.now = func() time.Time { return createdAt }
	if _, err := service.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	before, err := store.NativeEvents(ctx)
	if err != nil || len(before) != 1 {
		t.Fatalf("native events before update = %+v, %v", before, err)
	}
	updatedStart := start.Add(time.Hour)
	proposal.Title = "D&D campaign"
	proposal.ScheduledAt = &updatedStart
	if err := captureStore.Resolve(ctx, captured.ID, proposal, "filed", createdAt.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	after, err := store.NativeEvents(ctx)
	if err != nil || len(after) != 1 {
		t.Fatalf("native events after update = %+v, %v", after, err)
	}
	if after[0].ID != before[0].ID {
		t.Fatalf("event identity changed from %q to %q", before[0].ID, after[0].ID)
	}
	if _, err := service.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	if len(provider.objects) != 1 {
		t.Fatalf("remote object count = %d, want 1", len(provider.objects))
	}
	link, err := store.LinkByLocalID(ctx, after[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	remote, err := decodeNativeEvent(provider.objects[link.RemotePath].Payload, after[0].ID, after[0].CreatedAt)
	if err != nil {
		t.Fatal(err)
	}
	if remote.Title != "D&D campaign" || remote.StartAt == nil || !remote.StartAt.Equal(updatedStart) {
		t.Fatalf("remote event after update = %+v", remote)
	}
}

func TestSyncDeletesOrphanedDashboardifyRemoteObject(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "dashboardify.db")
	captureStore, err := capture.OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer captureStore.Close()
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	start := time.Date(2026, time.July, 8, 2, 0, 0, 0, time.UTC)
	payload, err := encodeNativeEvent(NativeEvent{
		ID: "deleted-event", Title: "D&D", StartAt: &start, Timezone: "UTC", Status: "confirmed",
	}, start)
	if err != nil {
		t.Fatal(err)
	}
	objectPath := "/calendars/user/dashboardify/deleted-event.ics"
	provider := &fakeProvider{
		discovery: Discovery{
			PrincipalPath: "/principal/", HomeSetPath: "/calendars/user/",
			Selected: CalendarChoice{Path: "/calendars/user/dashboardify/", Name: "Dashboardify"},
		},
		objects: map[string]RemoteObject{
			objectPath: {
				Path: objectPath, ETag: "orphan-v1", UID: "deleted-event@dashboardify",
				Payload: payload, PayloadHash: hashText(payload),
			},
		},
	}
	service, err := NewService(ctx, Config{
		Enabled: true, Endpoint: "https://caldav.example/", Username: "user",
		Password: "secret", CalendarName: "Dashboardify",
	}, store, provider)
	if err != nil {
		t.Fatal(err)
	}
	service.now = func() time.Time { return start }
	summary, err := service.Sync(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Deleted != 1 || len(provider.objects) != 0 {
		t.Fatalf("sync = %+v, remote objects = %d; want one orphan deleted", summary, len(provider.objects))
	}
}

func TestSyncDetectsConcurrentChangesAndResolvesLocal(t *testing.T) {
	ctx, service, store, provider, event := seededSyncedService(t)
	local := event
	local.Title = "Local title"
	if err := store.UpdateNativeEvent(ctx, local, time.Now()); err != nil {
		t.Fatal(err)
	}
	link, err := store.LinkByLocalID(ctx, local.ID)
	if err != nil {
		t.Fatal(err)
	}
	remote := provider.objects[link.RemotePath]
	remoteVersion := event
	remoteVersion.Title = "Remote title"
	payload, err := encodeNativeEvent(remoteVersion, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	remote.Payload = payload
	remote.PayloadHash = hashText(payload)
	remote.ETag = "remote-conflict"
	provider.objects[link.RemotePath] = remote

	summary, err := service.Sync(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Conflicts != 1 {
		t.Fatalf("conflicts = %d, want 1", summary.Conflicts)
	}
	conflicts, err := service.Conflicts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(conflicts) != 1 || conflicts[0].Kind != "local_and_remote_changed" {
		t.Fatalf("conflicts = %+v", conflicts)
	}
	if err := service.ResolveConflict(ctx, local.ID, "local"); err != nil {
		t.Fatal(err)
	}
	stored, err := decodeNativeEvent(provider.objects[link.RemotePath].Payload, local.ID, local.CreatedAt)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Title != "Local title" {
		t.Fatalf("resolved remote title = %q, want Local title", stored.Title)
	}
}

func TestSyncAppliesUnmodifiedRemoteDeletion(t *testing.T) {
	ctx, service, store, provider, event := seededSyncedService(t)
	link, err := store.LinkByLocalID(ctx, event.ID)
	if err != nil {
		t.Fatal(err)
	}
	delete(provider.objects, link.RemotePath)
	if _, err := service.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	updated, err := store.NativeEventByID(ctx, event.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != "cancelled" {
		t.Fatalf("status = %q, want cancelled", updated.Status)
	}
}

func seededSyncedService(t *testing.T) (context.Context, *Service, *Store, *fakeProvider, NativeEvent) {
	t.Helper()
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "dashboardify.db")
	captureStore, err := capture.OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { captureStore.Close() })
	createdAt := time.Date(2026, time.July, 7, 9, 0, 0, 0, time.UTC)
	captured, _, err := captureStore.InsertRaw(ctx, "seeded-sync", "event: Seeded event", "UTC", createdAt)
	if err != nil {
		t.Fatal(err)
	}
	start := createdAt.Add(24 * time.Hour)
	if err := captureStore.Resolve(ctx, captured.ID, capture.Proposal{
		Kind: capture.KindEvent, Title: "Seeded event", ScheduledAt: &start, ScheduledTimezone: "UTC",
	}, "filed", createdAt); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	provider := &fakeProvider{
		discovery: Discovery{
			PrincipalPath: "/principal/", HomeSetPath: "/calendars/user/",
			Selected: CalendarChoice{Path: "/calendars/user/dashboardify/", Name: "Dashboardify"},
		},
		objects: make(map[string]RemoteObject),
	}
	service, err := NewService(ctx, Config{
		Enabled: true, Endpoint: "https://caldav.example/", Username: "user",
		Password: "secret", CalendarName: "Dashboardify",
	}, store, provider)
	if err != nil {
		t.Fatal(err)
	}
	service.now = func() time.Time { return createdAt }
	if _, err := service.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	events, err := store.NativeEvents(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("native events = %d, want 1", len(events))
	}
	return ctx, service, store, provider, events[0]
}

func timePointer(value time.Time) *time.Time {
	return &value
}

func TestFakeProviderRejectsStaleETag(t *testing.T) {
	provider := &fakeProvider{objects: map[string]RemoteObject{
		"/event.ics": {Path: "/event.ics", ETag: "current"},
	}}
	_, err := provider.Put(context.Background(), "/event.ics", "payload", "stale")
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("error = %v, want conflict", err)
	}
}

func TestAgendaExpandsRecurringAppleEventForSelectedDay(t *testing.T) {
	payload := "BEGIN:VCALENDAR\r\n" +
		"VERSION:2.0\r\n" +
		"PRODID:-//Calendar Test//EN\r\n" +
		"BEGIN:VEVENT\r\n" +
		"UID:daily-review@example.com\r\n" +
		"DTSTAMP:20260701T120000Z\r\n" +
		"DTSTART:20260708T160000Z\r\n" +
		"DTEND:20260708T163000Z\r\n" +
		"RRULE:FREQ=DAILY;COUNT=3\r\n" +
		"SUMMARY:Daily review\r\n" +
		"END:VEVENT\r\n" +
		"END:VCALENDAR\r\n"
	start := time.Date(2026, time.July, 9, 0, 0, 0, 0, time.UTC)
	events, err := agendaEvents(RemoteObject{
		Path: "/external/daily.ics", UID: "daily-review@example.com", Payload: payload,
	}, start, start.AddDate(0, 0, 1), time.UTC)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Title != "Daily review" || events[0].StartAt == nil ||
		!events[0].StartAt.Equal(time.Date(2026, time.July, 9, 16, 0, 0, 0, time.UTC)) {
		t.Fatalf("agenda events = %+v", events)
	}
}
