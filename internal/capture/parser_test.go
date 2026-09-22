package capture

import (
	"testing"
	"time"
)

func TestParserRecognizesReminderTimeDateAndPlace(t *testing.T) {
	location := mustLocation(t, "America/Los_Angeles")
	parser := NewParser(location)
	now := time.Date(2026, time.January, 5, 10, 0, 0, 0, location)

	proposal := parser.Parse("Remind me to submit report at 2:30 on wedensday at the office", now)

	if proposal.Kind != KindReminder {
		t.Fatalf("Kind = %q, want %q", proposal.Kind, KindReminder)
	}
	if proposal.Title != "submit report" {
		t.Fatalf("Title = %q, want submit report", proposal.Title)
	}
	if proposal.Place != "the office" {
		t.Fatalf("Place = %q, want the office", proposal.Place)
	}
	want := time.Date(2026, time.January, 7, 22, 30, 0, 0, time.UTC)
	if proposal.ScheduledAt == nil || !proposal.ScheduledAt.Equal(want) {
		t.Fatalf("ScheduledAt = %v, want %v", proposal.ScheduledAt, want)
	}
	if proposal.DisplayWhen != "Wed, Jan 7 · 2:30 PM" {
		t.Fatalf("DisplayWhen = %q", proposal.DisplayWhen)
	}
	assertHighlightKinds(t, proposal.Highlights, "intent", "time", "date", "place")
}

func TestParserRecognizesAllDayReminder(t *testing.T) {
	location := mustLocation(t, "America/Los_Angeles")
	parser := NewParser(location)
	now := time.Date(2026, time.January, 5, 10, 0, 0, 0, location)

	proposal := parser.Parse("Remind me to file taxes on Wednesday", now)

	if proposal.Kind != KindReminder {
		t.Fatalf("Kind = %q, want %q", proposal.Kind, KindReminder)
	}
	if proposal.Title != "file taxes" {
		t.Fatalf("Title = %q, want file taxes", proposal.Title)
	}
	if !proposal.AllDay || proposal.ScheduledDate != "2026-01-07" {
		t.Fatalf("all-day schedule = %t %q, want true 2026-01-07", proposal.AllDay, proposal.ScheduledDate)
	}
	if proposal.ScheduledAt != nil {
		t.Fatalf("ScheduledAt = %v, want nil for all-day reminder", proposal.ScheduledAt)
	}
	if proposal.DisplayWhen != "Wed, Jan 7 · all day" {
		t.Fatalf("DisplayWhen = %q", proposal.DisplayWhen)
	}
}

func TestParserUsesAtSignAsEventIntent(t *testing.T) {
	location := mustLocation(t, "America/Los_Angeles")
	parser := NewParser(location)
	now := time.Date(2026, time.January, 5, 10, 0, 0, 0, location)

	proposal := parser.Parse("Baseball @ 2:30 on Wednesday", now)

	if proposal.Kind != KindEvent {
		t.Fatalf("Kind = %q, want %q", proposal.Kind, KindEvent)
	}
	if proposal.Title != "Baseball" {
		t.Fatalf("Title = %q, want Baseball", proposal.Title)
	}
	if proposal.ScheduledAt == nil || proposal.ScheduledAt.In(location).Hour() != 14 || proposal.ScheduledAt.In(location).Minute() != 30 {
		t.Fatalf("ScheduledAt = %v, want 2:30 PM local", proposal.ScheduledAt)
	}
}

func TestParserFallsBackToNoteWithoutReinterpretingContent(t *testing.T) {
	location := mustLocation(t, "America/Los_Angeles")
	parser := NewParser(location)
	now := time.Date(2026, time.January, 5, 10, 0, 0, 0, location)
	text := "Baseball practice notes from Wednesday"

	proposal := parser.Parse(text, now)

	if proposal.Kind != KindNote {
		t.Fatalf("Kind = %q, want %q", proposal.Kind, KindNote)
	}
	if proposal.Title != text {
		t.Fatalf("Title = %q, want exact note text", proposal.Title)
	}
	if proposal.ScheduledAt != nil || len(proposal.Highlights) != 0 {
		t.Fatalf("note unexpectedly parsed scheduling fields: %#v", proposal)
	}
}

func TestParserAcceptsEquivalentNaturalLanguageForms(t *testing.T) {
	location := mustLocation(t, "America/Los_Angeles")
	parser := NewParser(location)
	now := time.Date(2026, time.January, 5, 10, 0, 0, 0, location)
	tests := []struct {
		text  string
		kind  Kind
		title string
	}{
		{"Don't forget to call Mom on Friday at 7pm", KindReminder, "call Mom"},
		{"Remember to bring the forms tomorrow at 9", KindReminder, "bring the forms"},
		{"todo: renew registration at 4:15 on Thursday", KindReminder, "renew registration"},
		{"Schedule dentist next Tuesday at 9:15 am", KindEvent, "dentist"},
		{"Lunch at 12:30 tomorrow", KindEvent, "Lunch"},
		{"note: the game starts Wednesday at 2:30", KindNote, "the game starts Wednesday at 2:30"},
	}

	for _, test := range tests {
		t.Run(test.text, func(t *testing.T) {
			proposal := parser.Parse(test.text, now)
			if proposal.Kind != test.kind {
				t.Fatalf("Kind = %q, want %q", proposal.Kind, test.kind)
			}
			if proposal.Title != test.title {
				t.Fatalf("Title = %q, want %q", proposal.Title, test.title)
			}
		})
	}
}

func TestParserHighlightOffsetsUseUnicodeCharacters(t *testing.T) {
	location := mustLocation(t, "UTC")
	proposal := NewParser(location).Parse("⚾ Baseball @ 2:30 tomorrow", time.Date(2026, time.January, 5, 10, 0, 0, 0, location))
	runes := []rune("⚾ Baseball @ 2:30 tomorrow")

	for _, item := range proposal.Highlights {
		if item.Start < 0 || item.End > len(runes) || item.Start >= item.End {
			t.Fatalf("invalid highlight range %#v for %d runes", item, len(runes))
		}
	}
	if got := string(runes[proposal.Highlights[0].Start:proposal.Highlights[0].End]); got != "@ 2:30" {
		t.Fatalf("first highlighted text = %q, want @ 2:30", got)
	}
}

func assertHighlightKinds(t *testing.T, highlights []Highlight, want ...string) {
	t.Helper()
	if len(highlights) != len(want) {
		t.Fatalf("highlight count = %d, want %d: %#v", len(highlights), len(want), highlights)
	}
	for index, kind := range want {
		if highlights[index].Kind != kind {
			t.Fatalf("highlight %d kind = %q, want %q", index, highlights[index].Kind, kind)
		}
	}
}

func mustLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	location, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("load location: %v", err)
	}
	return location
}
