package capture

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxCaptureBytes = 4096
	maxKeyBytes     = 128
)

var (
	ErrTextRequired        = errors.New("capture text is required")
	ErrTextTooLong         = errors.New("capture text exceeds 4096 bytes")
	ErrIdempotencyRequired = errors.New("idempotency key is required")
	ErrIdempotencyInvalid  = errors.New("idempotency key is invalid")
	ErrCaptureNotFound     = errors.New("capture was not found")
	ErrKindInvalid         = errors.New("capture kind is invalid")
	ErrSubjectRequired     = errors.New("a fact requires a subject")
	ErrDateInvalid         = errors.New("capture date must use YYYY-MM-DD")
	ErrTaskNotFound        = errors.New("task was not found")
	ErrTaskStatusInvalid   = errors.New("task status is invalid")
)

type Service struct {
	store  *Store
	parser *Parser
	now    func() time.Time
}

func NewService(store *Store, parser *Parser, now func() time.Time) *Service {
	return &Service{store: store, parser: parser, now: now}
}

func (service *Service) Preview(text string) (Proposal, error) {
	if err := validateText(text); err != nil {
		return Proposal{}, err
	}
	return service.parser.Parse(text, service.now()), nil
}

func (service *Service) Create(ctx context.Context, key, text string) (Record, error) {
	if err := validateText(text); err != nil {
		return Record{}, err
	}
	if err := validateKey(key); err != nil {
		return Record{}, err
	}

	now := service.now()
	record, inserted, err := service.store.InsertRaw(ctx, key, text, service.parser.location.String(), now)
	if err != nil {
		return Record{}, err
	}
	if inserted || record.State == "pending" {
		proposal := service.parser.Parse(text, now)
		inboxState := "filed"
		if proposal.NeedsReview {
			inboxState = "open"
		}
		if err := service.store.Resolve(ctx, record.ID, proposal, inboxState, now); err != nil {
			return service.decorate(record), err
		}
		record, err = service.store.ByID(ctx, record.ID)
		if err != nil {
			return Record{}, err
		}
	}
	return service.decorate(record), nil
}

func (service *Service) List(ctx context.Context, limit int) ([]Record, error) {
	if limit < 1 || limit > 50 {
		limit = 12
	}
	records, err := service.store.List(ctx, limit)
	if err != nil {
		return nil, err
	}
	for index := range records {
		records[index] = service.decorate(records[index])
	}
	return records, nil
}

func (service *Service) Inbox(ctx context.Context, limit int) ([]Record, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	records, err := service.store.ListInbox(ctx, limit)
	if err != nil {
		return nil, err
	}
	for index := range records {
		records[index] = service.decorate(records[index])
	}
	return records, nil
}

type Detail struct {
	Capture Record           `json:"capture"`
	History []Classification `json:"history"`
}

func (service *Service) Detail(ctx context.Context, id string) (Detail, error) {
	record, err := service.store.ByID(ctx, id)
	if err != nil {
		return Detail{}, mapNotFound(err)
	}
	history, err := service.store.ClassificationHistory(ctx, id)
	if err != nil {
		return Detail{}, err
	}
	return Detail{Capture: service.decorate(record), History: history}, nil
}

func (service *Service) File(ctx context.Context, id string, proposal Proposal) (Record, error) {
	proposal.Title = strings.TrimSpace(proposal.Title)
	proposal.Subject = strings.TrimSpace(proposal.Subject)
	proposal.Place = strings.TrimSpace(proposal.Place)
	if err := validateText(proposal.Title); err != nil {
		return Record{}, err
	}
	switch proposal.Kind {
	case KindReminder, KindEvent, KindNote:
	case KindFact:
		if proposal.Subject == "" {
			return Record{}, ErrSubjectRequired
		}
	case KindActivity:
		if proposal.OccurredDate == "" {
			proposal.OccurredDate = service.now().In(service.parser.location).Format(time.DateOnly)
		}
	default:
		return Record{}, ErrKindInvalid
	}
	if proposal.ScheduledDate != "" {
		if _, err := time.ParseInLocation(time.DateOnly, proposal.ScheduledDate, service.parser.location); err != nil {
			return Record{}, ErrDateInvalid
		}
	}
	if proposal.OccurredDate != "" {
		if _, err := time.ParseInLocation(time.DateOnly, proposal.OccurredDate, service.parser.location); err != nil {
			return Record{}, ErrDateInvalid
		}
	}
	if proposal.ScheduledTimezone == "" {
		proposal.ScheduledTimezone = service.parser.location.String()
	}
	if err := service.store.Resolve(ctx, id, proposal, "filed", service.now()); err != nil {
		return Record{}, mapNotFound(err)
	}
	record, err := service.store.ByID(ctx, id)
	if err != nil {
		return Record{}, mapNotFound(err)
	}
	return service.decorate(record), nil
}

type TodayView struct {
	Date     string        `json:"date"`
	Timezone string        `json:"timezone"`
	Tasks    []TaskRecord  `json:"tasks"`
	Events   []EventRecord `json:"events"`
}

func (service *Service) Today(ctx context.Context, date string) (TodayView, error) {
	if date == "" {
		date = service.now().In(service.parser.location).Format(time.DateOnly)
	}
	day, err := time.ParseInLocation(time.DateOnly, date, service.parser.location)
	if err != nil {
		return TodayView{}, ErrDateInvalid
	}
	end := day.AddDate(0, 0, 1)
	tasks, events, err := service.store.TodayRecords(ctx, date, day, end)
	if err != nil {
		return TodayView{}, err
	}
	for index := range tasks {
		task := &tasks[index]
		deferredPast := task.DeferredUntilDate == "" || task.DeferredUntilDate < date
		task.Overdue = task.Status == "open" && deferredPast &&
			((task.DueAt != nil && task.DueAt.Before(day)) ||
				(task.DueDate != "" && task.DueDate < date))
	}
	return TodayView{
		Date:     date,
		Timezone: service.parser.location.String(),
		Tasks:    tasks,
		Events:   events,
	}, nil
}

func (service *Service) UpdateTask(ctx context.Context, id string, update TaskUpdate) (TaskRecord, error) {
	update.Title = strings.TrimSpace(update.Title)
	update.Place = strings.TrimSpace(update.Place)
	if err := validateText(update.Title); err != nil {
		return TaskRecord{}, err
	}
	switch update.Status {
	case "open":
		update.CompletedAt = nil
	case "completed":
		if update.CompletedAt == nil {
			completedAt := service.now()
			update.CompletedAt = &completedAt
		}
	case "archived":
	default:
		return TaskRecord{}, ErrTaskStatusInvalid
	}
	for _, date := range []string{update.DueDate, update.DeferredUntilDate} {
		if date == "" {
			continue
		}
		if _, err := time.ParseInLocation(time.DateOnly, date, service.parser.location); err != nil {
			return TaskRecord{}, ErrDateInvalid
		}
	}
	if update.DueAt != nil {
		update.DueDate = ""
		update.AllDay = false
	} else if update.DueDate != "" {
		update.AllDay = true
	}
	task, err := service.store.UpdateTask(ctx, id, update, service.now())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return TaskRecord{}, ErrTaskNotFound
		}
		return TaskRecord{}, err
	}
	return task, nil
}

func (service *Service) decorate(record Record) Record {
	if record.ScheduledAt != nil {
		record.DisplayWhen = record.ScheduledAt.In(service.parser.location).Format("Mon, Jan 2 · 3:04 PM")
	} else if record.AllDay && record.ScheduledDate != "" {
		if day, err := time.ParseInLocation(time.DateOnly, record.ScheduledDate, service.parser.location); err == nil {
			record.DisplayWhen = day.Format("Mon, Jan 2") + " · all day"
		}
	} else if record.Kind == KindActivity && record.OccurredDate != "" {
		if day, err := time.ParseInLocation(time.DateOnly, record.OccurredDate, service.parser.location); err == nil {
			record.DisplayWhen = day.Format("Mon, Jan 2")
		}
	}
	return record
}

func validateText(text string) error {
	if strings.TrimSpace(text) == "" {
		return ErrTextRequired
	}
	if len(text) > maxCaptureBytes || !utf8.ValidString(text) {
		return ErrTextTooLong
	}
	return nil
}

func validateKey(key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return ErrIdempotencyRequired
	}
	if len(key) > maxKeyBytes || strings.ContainsAny(key, "\r\n\x00") {
		return ErrIdempotencyInvalid
	}
	return nil
}

func mapNotFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrCaptureNotFound
	}
	return err
}
