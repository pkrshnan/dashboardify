package calendar

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	pathpkg "path"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/emersion/go-ical"
)

type Service struct {
	config   Config
	store    *Store
	provider Provider
	now      func() time.Time
	mutex    sync.Mutex
}

func NewService(ctx context.Context, cfg Config, store *Store, provider Provider) (*Service, error) {
	service := &Service{config: cfg, store: store, provider: provider, now: time.Now}
	if cfg.Enabled {
		if provider == nil {
			return nil, errors.New("calendar provider is required when CalDAV is enabled")
		}
		if err := store.EnsureIntegration(ctx, cfg, service.now()); err != nil {
			return nil, err
		}
	}
	return service, nil
}

func (service *Service) Status(ctx context.Context) (Status, error) {
	if !service.config.Enabled {
		return Status{Configured: false, State: "not_configured", CalendarName: service.config.CalendarName}, nil
	}
	integration, err := service.store.Integration(ctx)
	if err != nil {
		return Status{}, fmt.Errorf("read calendar status: %w", err)
	}
	conflicts, err := service.store.ConflictCount(ctx)
	if err != nil {
		return Status{}, fmt.Errorf("count calendar conflicts: %w", err)
	}
	return Status{
		Configured:    true,
		State:         integration.State,
		CalendarName:  integration.CalendarName,
		CalendarPath:  integration.CalendarPath,
		LastAttemptAt: integration.LastAttemptAt,
		LastSuccessAt: integration.LastSuccessAt,
		LastError:     integration.LastError,
		ConflictCount: conflicts,
	}, nil
}

func (service *Service) Discover(ctx context.Context) (Discovery, error) {
	if !service.config.Enabled {
		return Discovery{}, errors.New("Apple Calendar is not configured")
	}
	service.mutex.Lock()
	defer service.mutex.Unlock()
	return service.discover(ctx)
}

func (service *Service) discover(ctx context.Context) (Discovery, error) {
	discovery, err := service.provider.Discover(ctx, service.config.CalendarName)
	if err != nil {
		return Discovery{}, err
	}
	if err := service.store.SaveDiscovery(ctx, discovery, service.now()); err != nil {
		return Discovery{}, err
	}
	return discovery, nil
}

func (service *Service) Sync(ctx context.Context) (SyncSummary, error) {
	if !service.config.Enabled {
		return SyncSummary{}, errors.New("Apple Calendar is not configured")
	}
	service.mutex.Lock()
	defer service.mutex.Unlock()

	integration, err := service.store.Integration(ctx)
	if err != nil {
		return SyncSummary{}, fmt.Errorf("read calendar integration: %w", err)
	}
	now := service.now().UTC()
	runID, err := service.store.BeginSync(ctx, now)
	if err != nil {
		return SyncSummary{}, err
	}
	summary := SyncSummary{SyncedAt: now}
	var syncErr error
	if integration.CalendarPath == "" {
		if _, syncErr = service.discover(ctx); syncErr == nil {
			integration, syncErr = service.store.Integration(ctx)
			if syncErr != nil {
				syncErr = fmt.Errorf("read discovered calendar integration: %w", syncErr)
			}
		}
	}
	if syncErr == nil {
		syncErr = service.sync(ctx, integration, &summary)
	}
	if finishErr := service.store.FinishSync(ctx, runID, "", summary, syncErr); finishErr != nil {
		if syncErr != nil {
			return summary, fmt.Errorf("%v; record sync result: %w", syncErr, finishErr)
		}
		return summary, finishErr
	}
	return summary, syncErr
}

func (service *Service) sync(ctx context.Context, integration Integration, summary *SyncSummary) error {
	knownObjects, err := service.store.ActiveRemoteObjects(ctx)
	if err != nil {
		return err
	}
	remoteObjects, err := service.provider.List(ctx, integration.CalendarPath)
	if err != nil {
		return err
	}
	remotePaths := make(map[string]struct{}, len(remoteObjects))
	for _, object := range remoteObjects {
		remotePaths[object.Path] = struct{}{}
		if err := service.pullObject(ctx, object, summary); err != nil {
			return err
		}
	}
	for _, object := range knownObjects {
		if _, exists := remotePaths[object.Path]; exists {
			continue
		}
		if err := service.pullDeletion(ctx, object, summary); err != nil {
			return err
		}
	}
	return service.pushNativeEvents(ctx, integration, summary)
}

func (service *Service) pullObject(ctx context.Context, object RemoteObject, summary *SyncSummary) error {
	now := service.now().UTC()
	object.PayloadHash = hashText(object.Payload)
	if err := service.store.UpsertRemoteObject(ctx, object, now); err != nil {
		return err
	}
	link, err := service.store.LinkByRemotePath(ctx, object.Path)
	if errors.Is(err, sql.ErrNoRows) {
		return service.reconcileUnlinkedManagedObject(ctx, object, summary, now)
	}
	if err != nil {
		return fmt.Errorf("read remote event link: %w", err)
	}
	local, err := service.store.NativeEventByID(ctx, link.LocalEventID)
	if err != nil {
		return fmt.Errorf("read linked native event: %w", err)
	}
	localHash := hashNativeEvent(local)
	if object.PayloadHash == link.LastRemoteHash {
		link.ETag = object.ETag
		return service.store.SaveLink(ctx, link, now)
	}
	if localHash != link.LastLocalHash {
		link.ETag = object.ETag
		link.ConflictState = "local_and_remote_changed"
		link.PendingRemotePayload = object.Payload
		link.RemoteDeleted = false
		if err := service.store.SaveLink(ctx, link, now); err != nil {
			return err
		}
		summary.Conflicts++
		return nil
	}
	updated, err := decodeNativeEvent(object.Payload, local.ID, local.CreatedAt)
	if err != nil {
		return fmt.Errorf("decode changed remote event %q: %w", object.Path, err)
	}
	if err := service.store.UpdateNativeEvent(ctx, updated, now); err != nil {
		return err
	}
	link.ETag = object.ETag
	link.RemoteUID = object.UID
	link.LastLocalHash = hashNativeEvent(updated)
	link.LastRemoteHash = object.PayloadHash
	link.ConflictState = ""
	link.PendingRemotePayload = ""
	link.RemoteDeleted = false
	if err := service.store.SaveLink(ctx, link, now); err != nil {
		return err
	}
	summary.Pulled++
	return nil
}

func (service *Service) reconcileUnlinkedManagedObject(
	ctx context.Context,
	object RemoteObject,
	summary *SyncSummary,
	now time.Time,
) error {
	localEventID, managed := managedEventID(object.UID)
	if !managed {
		summary.Pulled++
		return nil
	}
	if existing, err := service.store.LinkByLocalID(ctx, localEventID); err == nil {
		if existing.RemotePath != object.Path {
			return service.deleteManagedOrphan(ctx, object, summary, now)
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("read managed event link: %w", err)
	}
	local, err := service.store.NativeEventByID(ctx, localEventID)
	if errors.Is(err, sql.ErrNoRows) {
		return service.deleteManagedOrphan(ctx, object, summary, now)
	}
	if err != nil {
		return fmt.Errorf("read unlinked managed event: %w", err)
	}
	remote, err := decodeNativeEvent(object.Payload, local.ID, local.CreatedAt)
	if err != nil {
		return fmt.Errorf("decode unlinked managed event %q: %w", object.Path, err)
	}
	localHash := hashNativeEvent(local)
	remoteLocalHash := hashNativeEvent(remote)
	link := EventLink{
		LocalEventID:   local.ID,
		RemotePath:     object.Path,
		RemoteUID:      object.UID,
		ETag:           object.ETag,
		LastRemoteHash: object.PayloadHash,
	}
	if localHash == remoteLocalHash {
		link.LastLocalHash = localHash
	} else {
		link.ConflictState = "unlinked_managed_event_changed"
		link.PendingRemotePayload = object.Payload
		summary.Conflicts++
	}
	if err := service.store.SaveLink(ctx, link, now); err != nil {
		return err
	}
	summary.Pulled++
	return nil
}

func (service *Service) deleteManagedOrphan(
	ctx context.Context,
	object RemoteObject,
	summary *SyncSummary,
	now time.Time,
) error {
	if err := service.provider.Delete(ctx, object.Path, object.ETag); err != nil {
		return fmt.Errorf("delete orphaned Dashboardify calendar object: %w", err)
	}
	if err := service.store.MarkRemoteDeleted(ctx, object.Path, now); err != nil {
		return err
	}
	summary.Deleted++
	return nil
}

func managedEventID(uid string) (string, bool) {
	const suffix = "@dashboardify"
	if !strings.HasSuffix(uid, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(uid, suffix)
	return id, id != ""
}

func (service *Service) pullDeletion(ctx context.Context, object RemoteObject, summary *SyncSummary) error {
	now := service.now().UTC()
	if err := service.store.MarkRemoteDeleted(ctx, object.Path, now); err != nil {
		return err
	}
	link, err := service.store.LinkByRemotePath(ctx, object.Path)
	if errors.Is(err, sql.ErrNoRows) {
		summary.Deleted++
		return nil
	}
	if err != nil {
		return fmt.Errorf("read deleted remote event link: %w", err)
	}
	local, err := service.store.NativeEventByID(ctx, link.LocalEventID)
	if err != nil {
		return fmt.Errorf("read native event for remote deletion: %w", err)
	}
	if hashNativeEvent(local) != link.LastLocalHash {
		link.ConflictState = "remote_deleted_local_changed"
		link.PendingRemotePayload = ""
		link.RemoteDeleted = true
		if err := service.store.SaveLink(ctx, link, now); err != nil {
			return err
		}
		summary.Conflicts++
		return nil
	}
	local.Status = "cancelled"
	if err := service.store.UpdateNativeEvent(ctx, local, now); err != nil {
		return err
	}
	link.LastLocalHash = hashNativeEvent(local)
	link.RemoteDeleted = true
	link.ConflictState = ""
	link.PendingRemotePayload = ""
	if err := service.store.SaveLink(ctx, link, now); err != nil {
		return err
	}
	summary.Deleted++
	return nil
}

func (service *Service) pushNativeEvents(ctx context.Context, integration Integration, summary *SyncSummary) error {
	events, err := service.store.NativeEvents(ctx)
	if err != nil {
		return err
	}
	for _, event := range events {
		link, err := service.store.LinkByLocalID(ctx, event.ID)
		if errors.Is(err, sql.ErrNoRows) {
			if event.Status == "cancelled" {
				continue
			}
			if err := service.createRemoteEvent(ctx, integration, event, summary); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return fmt.Errorf("read native event link: %w", err)
		}
		if link.ConflictState != "" {
			continue
		}
		if event.Status == "cancelled" {
			if !link.RemoteDeleted {
				if err := service.provider.Delete(ctx, link.RemotePath, link.ETag); err != nil {
					if errors.Is(err, ErrConflict) {
						link.ConflictState = "local_deleted_remote_changed"
						if saveErr := service.store.SaveLink(ctx, link, service.now()); saveErr != nil {
							return saveErr
						}
						summary.Conflicts++
						continue
					}
					return err
				}
				link.RemoteDeleted = true
				link.LastLocalHash = hashNativeEvent(event)
				if err := service.store.SaveLink(ctx, link, service.now()); err != nil {
					return err
				}
				if err := service.store.MarkRemoteDeleted(ctx, link.RemotePath, service.now()); err != nil {
					return err
				}
				summary.Deleted++
			}
			continue
		}
		localHash := hashNativeEvent(event)
		if localHash == link.LastLocalHash {
			continue
		}
		payload, err := encodeNativeEvent(event, service.now())
		if err != nil {
			return err
		}
		stored, err := service.provider.Put(ctx, link.RemotePath, payload, link.ETag)
		if errors.Is(err, ErrConflict) {
			link.ConflictState = "local_changed_remote_changed"
			if saveErr := service.store.SaveLink(ctx, link, service.now()); saveErr != nil {
				return saveErr
			}
			summary.Conflicts++
			continue
		}
		if err != nil {
			return err
		}
		if err := service.store.UpsertRemoteObject(ctx, stored, service.now()); err != nil {
			return err
		}
		link.ETag = stored.ETag
		link.LastLocalHash = localHash
		link.LastRemoteHash = stored.PayloadHash
		link.RemoteDeleted = false
		if err := service.store.SaveLink(ctx, link, service.now()); err != nil {
			return err
		}
		summary.Pushed++
	}
	return nil
}

func (service *Service) createRemoteEvent(ctx context.Context, integration Integration, event NativeEvent, summary *SyncSummary) error {
	payload, err := encodeNativeEvent(event, service.now())
	if err != nil {
		return err
	}
	objectPath := pathpkg.Join(integration.CalendarPath, event.ID+".ics")
	stored, err := service.provider.Put(ctx, objectPath, payload, "")
	if err != nil {
		return err
	}
	now := service.now().UTC()
	if err := service.store.UpsertRemoteObject(ctx, stored, now); err != nil {
		return err
	}
	link := EventLink{
		LocalEventID:   event.ID,
		RemotePath:     objectPath,
		RemoteUID:      stored.UID,
		ETag:           stored.ETag,
		LastLocalHash:  hashNativeEvent(event),
		LastRemoteHash: stored.PayloadHash,
	}
	if err := service.store.SaveLink(ctx, link, now); err != nil {
		return err
	}
	summary.Pushed++
	return nil
}

func (service *Service) Conflicts(ctx context.Context) ([]Conflict, error) {
	if !service.config.Enabled {
		return []Conflict{}, nil
	}
	return service.store.Conflicts(ctx)
}

func (service *Service) Event(ctx context.Context, id string) (NativeEvent, error) {
	return service.store.NativeEventByID(ctx, id)
}

func (service *Service) UpdateEvent(ctx context.Context, event NativeEvent) (NativeEvent, error) {
	event.Title = strings.TrimSpace(event.Title)
	event.Place = strings.TrimSpace(event.Place)
	if event.Title == "" {
		return NativeEvent{}, errors.New("event title is required")
	}
	switch event.Status {
	case "confirmed", "tentative", "cancelled":
	default:
		return NativeEvent{}, errors.New("event status must be confirmed, tentative, or cancelled")
	}
	if event.AllDay {
		startDate, err := time.Parse(time.DateOnly, event.StartDate)
		if err != nil {
			return NativeEvent{}, errors.New("all-day event requires a valid start date")
		}
		if event.EndDate != "" {
			endDate, err := time.Parse(time.DateOnly, event.EndDate)
			if err != nil {
				return NativeEvent{}, errors.New("all-day event end date is invalid")
			}
			if !endDate.After(startDate) {
				return NativeEvent{}, errors.New("all-day event end date must be after its start date")
			}
		}
		event.StartAt = nil
		event.EndAt = nil
	} else {
		if event.StartAt == nil {
			return NativeEvent{}, errors.New("timed event requires a start time")
		}
		if event.EndAt != nil && !event.EndAt.After(*event.StartAt) {
			return NativeEvent{}, errors.New("event end time must be after its start time")
		}
		event.StartDate = ""
		event.EndDate = ""
	}
	now := service.now().UTC()
	if err := service.store.UpdateNativeEvent(ctx, event, now); err != nil {
		return NativeEvent{}, err
	}
	event.UpdatedAt = now
	return event, nil
}

func (service *Service) ResolveConflict(ctx context.Context, localEventID, strategy string) error {
	if !service.config.Enabled {
		return errors.New("Apple Calendar is not configured")
	}
	service.mutex.Lock()
	defer service.mutex.Unlock()
	link, err := service.store.LinkByLocalID(ctx, localEventID)
	if err != nil {
		return fmt.Errorf("read calendar conflict: %w", err)
	}
	if link.ConflictState == "" {
		return errors.New("calendar event has no conflict")
	}
	now := service.now().UTC()
	switch strategy {
	case "remote":
		local, err := service.store.NativeEventByID(ctx, localEventID)
		if err != nil {
			return err
		}
		if link.RemoteDeleted {
			local.Status = "cancelled"
		} else {
			local, err = decodeNativeEvent(link.PendingRemotePayload, local.ID, local.CreatedAt)
			if err != nil {
				return err
			}
		}
		if err := service.store.UpdateNativeEvent(ctx, local, now); err != nil {
			return err
		}
		link.LastLocalHash = hashNativeEvent(local)
		if link.PendingRemotePayload != "" {
			link.LastRemoteHash = hashText(link.PendingRemotePayload)
		}
	case "local":
		local, err := service.store.NativeEventByID(ctx, localEventID)
		if err != nil {
			return err
		}
		payload, err := encodeNativeEvent(local, now)
		if err != nil {
			return err
		}
		etag := link.ETag
		if link.RemoteDeleted {
			etag = ""
		}
		stored, err := service.provider.Put(ctx, link.RemotePath, payload, etag)
		if err != nil {
			return err
		}
		if err := service.store.UpsertRemoteObject(ctx, stored, now); err != nil {
			return err
		}
		link.ETag = stored.ETag
		link.RemoteUID = stored.UID
		link.LastLocalHash = hashNativeEvent(local)
		link.LastRemoteHash = stored.PayloadHash
		link.RemoteDeleted = false
	default:
		return errors.New("conflict strategy must be local or remote")
	}
	link.ConflictState = ""
	link.PendingRemotePayload = ""
	return service.store.SaveLink(ctx, link, now)
}

func (service *Service) ExternalAgenda(ctx context.Context, start, end time.Time, location *time.Location) ([]AgendaEvent, error) {
	if !service.config.Enabled {
		return []AgendaEvent{}, nil
	}
	objects, err := service.store.ListAgendaObjects(ctx)
	if err != nil {
		return nil, err
	}
	events := make([]AgendaEvent, 0, len(objects))
	for _, object := range objects {
		decoded, err := agendaEvents(object, start, end, location)
		if err != nil {
			return nil, fmt.Errorf("decode agenda object %q: %w", object.Path, err)
		}
		events = append(events, decoded...)
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].AllDay != events[j].AllDay {
			return events[i].AllDay
		}
		if events[i].StartAt == nil {
			return true
		}
		if events[j].StartAt == nil {
			return false
		}
		return events[i].StartAt.Before(*events[j].StartAt)
	})
	return events, nil
}

func encodeNativeEvent(event NativeEvent, now time.Time) (string, error) {
	calendar := ical.NewCalendar()
	calendar.Props.SetText(ical.PropProductID, "-//Dashboardify//Apple Calendar Sync//EN")
	calendar.Props.SetText(ical.PropVersion, "2.0")
	component := ical.NewEvent()
	component.Props.SetText(ical.PropUID, event.ID+"@dashboardify")
	component.Props.SetDateTime(ical.PropDateTimeStamp, now.UTC())
	component.Props.SetText(ical.PropSummary, event.Title)
	if event.Place != "" {
		component.Props.SetText(ical.PropLocation, event.Place)
	}
	component.SetStatus(ical.EventStatus(strings.ToUpper(event.Status)))
	if event.AllDay {
		start, err := time.Parse("2006-01-02", event.StartDate)
		if err != nil {
			return "", fmt.Errorf("parse all-day event start: %w", err)
		}
		end := start.AddDate(0, 0, 1)
		if event.EndDate != "" {
			end, err = time.Parse("2006-01-02", event.EndDate)
			if err != nil {
				return "", fmt.Errorf("parse all-day event end: %w", err)
			}
		}
		component.Props.SetDate(ical.PropDateTimeStart, start)
		component.Props.SetDate(ical.PropDateTimeEnd, end)
	} else {
		if event.StartAt == nil {
			return "", errors.New("timed event requires start time")
		}
		location := time.UTC
		if event.Timezone != "" {
			if parsed, err := time.LoadLocation(event.Timezone); err == nil {
				location = parsed
			}
		}
		start := event.StartAt.In(location)
		end := start.Add(time.Hour)
		if event.EndAt != nil {
			end = event.EndAt.In(location)
		}
		component.Props.SetDateTime(ical.PropDateTimeStart, start)
		component.Props.SetDateTime(ical.PropDateTimeEnd, end)
	}
	calendar.Children = append(calendar.Children, component.Component)
	return encodeCalendar(calendar)
}

func decodeNativeEvent(payload, id string, createdAt time.Time) (NativeEvent, error) {
	calendar, err := ical.NewDecoder(strings.NewReader(payload)).Decode()
	if err != nil {
		return NativeEvent{}, err
	}
	events := calendar.Events()
	if len(events) == 0 {
		return NativeEvent{}, errors.New("calendar object has no event")
	}
	component := events[0]
	title, err := component.Props.Text(ical.PropSummary)
	if err != nil {
		return NativeEvent{}, err
	}
	place, err := component.Props.Text(ical.PropLocation)
	if err != nil {
		return NativeEvent{}, err
	}
	status, err := component.Status()
	if err != nil {
		return NativeEvent{}, err
	}
	statusText := strings.ToLower(string(status))
	if statusText == "" {
		statusText = "confirmed"
	}
	startProperty := component.Props.Get(ical.PropDateTimeStart)
	if startProperty == nil {
		return NativeEvent{}, errors.New("calendar event has no start")
	}
	event := NativeEvent{ID: id, Title: title, Place: place, Status: statusText, CreatedAt: createdAt}
	if startProperty.ValueType() == ical.ValueDate {
		start, err := startProperty.DateTime(time.UTC)
		if err != nil {
			return NativeEvent{}, err
		}
		end, err := component.DateTimeEnd(time.UTC)
		if err != nil {
			return NativeEvent{}, err
		}
		event.AllDay = true
		event.StartDate = start.Format("2006-01-02")
		event.EndDate = end.Format("2006-01-02")
		event.Timezone = "floating"
		return event, nil
	}
	timezone := startProperty.Params.Get(ical.ParamTimezoneID)
	location := time.UTC
	if timezone != "" {
		if parsed, err := time.LoadLocation(timezone); err == nil {
			location = parsed
		}
	}
	start, err := component.DateTimeStart(location)
	if err != nil {
		return NativeEvent{}, err
	}
	end, err := component.DateTimeEnd(location)
	if err != nil {
		return NativeEvent{}, err
	}
	start = start.UTC()
	end = end.UTC()
	event.StartAt = &start
	if !end.IsZero() {
		event.EndAt = &end
	}
	if timezone == "" {
		timezone = "UTC"
	}
	event.Timezone = timezone
	return event, nil
}

func agendaEvents(object RemoteObject, rangeStart, rangeEnd time.Time, fallbackLocation *time.Location) ([]AgendaEvent, error) {
	calendar, err := ical.NewDecoder(strings.NewReader(object.Payload)).Decode()
	if err != nil {
		return nil, err
	}
	result := make([]AgendaEvent, 0, 4)
	for _, component := range calendar.Events() {
		status, err := component.Status()
		if err != nil {
			return nil, err
		}
		if status == ical.EventCancelled || component.Props.Get(ical.PropRecurrenceID) != nil {
			continue
		}
		title, err := component.Props.Text(ical.PropSummary)
		if err != nil {
			return nil, err
		}
		place, err := component.Props.Text(ical.PropLocation)
		if err != nil {
			return nil, err
		}
		startProperty := component.Props.Get(ical.PropDateTimeStart)
		if startProperty == nil {
			continue
		}
		location := fallbackLocation
		if location == nil {
			location = time.UTC
		}
		timezone := startProperty.Params.Get(ical.ParamTimezoneID)
		if timezone != "" {
			if parsed, err := time.LoadLocation(timezone); err == nil {
				location = parsed
			}
		}
		start, err := component.DateTimeStart(location)
		if err != nil {
			return nil, err
		}
		end, err := component.DateTimeEnd(location)
		if err != nil {
			return nil, err
		}
		duration := end.Sub(start)
		starts := []time.Time{start}
		if recurrence, err := component.RecurrenceSet(location); err != nil {
			return nil, err
		} else if recurrence != nil {
			starts = recurrence.Between(rangeStart, rangeEnd, true)
		}
		for index, occurrence := range starts {
			if occurrence.Before(rangeStart) || !occurrence.Before(rangeEnd) {
				continue
			}
			allDay := startProperty.ValueType() == ical.ValueDate
			agenda := AgendaEvent{
				ID:         fmt.Sprintf("caldav:%s:%d", object.UID, index),
				Title:      title,
				AllDay:     allDay,
				Timezone:   timezone,
				Place:      place,
				Status:     strings.ToLower(string(status)),
				Provider:   "apple_calendar",
				ReadOnly:   true,
				RemotePath: object.Path,
			}
			if agenda.Status == "" {
				agenda.Status = "confirmed"
			}
			if allDay {
				agenda.StartDate = occurrence.Format("2006-01-02")
				agenda.EndDate = occurrence.Add(duration).Format("2006-01-02")
				agenda.Timezone = "floating"
			} else {
				occurrenceUTC := occurrence.UTC()
				endUTC := occurrence.Add(duration).UTC()
				agenda.StartAt = &occurrenceUTC
				agenda.EndAt = &endUTC
				if agenda.Timezone == "" {
					agenda.Timezone = location.String()
				}
			}
			result = append(result, agenda)
		}
	}
	return result, nil
}

func hashNativeEvent(event NativeEvent) string {
	start := ""
	if event.StartAt != nil {
		start = event.StartAt.UTC().Format(time.RFC3339Nano)
	}
	end := ""
	if event.EndAt != nil {
		end = event.EndAt.UTC().Format(time.RFC3339Nano)
	}
	return hashText(strings.Join([]string{
		event.Title, start, end, event.StartDate, event.EndDate,
		fmt.Sprintf("%t", event.AllDay), event.Timezone, event.Place, event.Status,
	}, "\x00"))
}

func hashText(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}
