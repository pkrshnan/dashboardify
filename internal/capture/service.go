package capture

import (
	"context"
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
		if err := service.store.Resolve(ctx, record.ID, proposal, now); err != nil {
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

func (service *Service) decorate(record Record) Record {
	if record.ScheduledAt != nil {
		record.DisplayWhen = record.ScheduledAt.In(service.parser.location).Format("Mon, Jan 2 · 3:04 PM")
	} else if record.AllDay && record.ScheduledDate != "" {
		if day, err := time.ParseInLocation(time.DateOnly, record.ScheduledDate, service.parser.location); err == nil {
			record.DisplayWhen = day.Format("Mon, Jan 2") + " · all day"
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
