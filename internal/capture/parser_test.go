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

func TestParserRecognizesStreetAddressAfterEventTime(t *testing.T) {
	location := mustLocation(t, "America/Los_Angeles")
	parser := NewParser(location)
	now := time.Date(2026, time.September, 28, 10, 0, 0, 0, location)

	proposal := parser.Parse("Visit Sergiu's house at 6pm on Wednesday at 500 Folsom St", now)

	if proposal.Kind != KindEvent {
		t.Fatalf("Kind = %q, want %q", proposal.Kind, KindEvent)
	}
	if proposal.Title != "Visit Sergiu's house" {
		t.Fatalf("Title = %q, want Visit Sergiu's house", proposal.Title)
	}
	if proposal.Place != "500 Folsom St" {
		t.Fatalf("Place = %q, want 500 Folsom St", proposal.Place)
	}
	assertHighlightKinds(t, proposal.Highlights, "time", "date", "place")
}

func TestParserRecognizesEventTimeRangeAndPlace(t *testing.T) {
	location := mustLocation(t, "America/Los_Angeles")
	parser := NewParser(location)
	now := time.Date(2026, time.September, 28, 10, 0, 0, 0, location)

	proposal := parser.Parse("Visit Sergiu from 6pm to 8pm on Wednesday at aparment", now)

	if proposal.Kind != KindEvent || proposal.Title != "Visit Sergiu" || proposal.Place != "aparment" {
		t.Fatalf("proposal = %#v", proposal)
	}
	wantStart := time.Date(2026, time.October, 1, 1, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2026, time.October, 1, 3, 0, 0, 0, time.UTC)
	if proposal.ScheduledAt == nil || !proposal.ScheduledAt.Equal(wantStart) {
		t.Fatalf("ScheduledAt = %v, want %v", proposal.ScheduledAt, wantStart)
	}
	if proposal.ScheduledEndAt == nil || !proposal.ScheduledEndAt.Equal(wantEnd) {
		t.Fatalf("ScheduledEndAt = %v, want %v", proposal.ScheduledEndAt, wantEnd)
	}
	if proposal.DisplayWhen != "Wed, Sep 30 · 6:00 PM–8:00 PM" {
		t.Fatalf("DisplayWhen = %q", proposal.DisplayWhen)
	}
	assertHighlightKinds(t, proposal.Highlights, "time", "date", "place")
}

func TestParserSupportsRecommendedCapturePhraseCorpus(t *testing.T) {
	location := mustLocation(t, "America/Los_Angeles")
	parser := NewParser(location)
	now := time.Date(2026, time.September, 30, 10, 0, 0, 0, location)
	tests := []struct {
		text       string
		kind       Kind
		title      string
		place      string
		start      string
		end        string
		startDate  string
		endDate    string
		recurrence string
	}{
		{"Dinner tomorrow at 7pm at Nopa", KindEvent, "Dinner", "Nopa", "2026-10-01T19:00", "", "", "", ""},
		{"Dentist October 5 at 9:30am", KindEvent, "Dentist", "", "2026-10-05T09:30", "", "", "", ""},
		{"Design review Friday 2–3:30pm", KindEvent, "Design review", "", "2026-10-02T14:00", "2026-10-02T15:30", "", "", ""},
		{"Gym tomorrow at 6pm for 45 minutes", KindEvent, "Gym", "", "2026-10-01T18:00", "2026-10-01T18:45", "", "", ""},
		{"Remind me in 20 minutes to check the oven", KindReminder, "check the oven", "", "2026-09-30T10:20", "", "", "", ""},
		{"Pay rent by Friday", KindReminder, "Pay rent", "", "", "", "2026-10-02", "", ""},
		{"Vacation October 10 through October 17", KindEvent, "Vacation", "", "", "", "2026-10-10", "2026-10-18", ""},
		{"D&D every Wednesday from 7pm to 10pm", KindEvent, "D&D", "", "2026-09-30T19:00", "2026-09-30T22:00", "", "", "FREQ=WEEKLY;BYDAY=WE"},
		{"Meeting tomorrow at 2pm via Zoom", KindEvent, "Meeting", "Zoom", "2026-10-01T14:00", "", "", "", ""},
		{"Put lunch with Alex on my calendar for Friday at noon", KindEvent, "lunch with Alex", "", "2026-10-02T12:00", "", "", "", ""},
	}

	for _, test := range tests {
		t.Run(test.text, func(t *testing.T) {
			proposal := parser.Parse(test.text, now)
			if proposal.Kind != test.kind || proposal.Title != test.title || proposal.Place != test.place {
				t.Fatalf("proposal = %#v", proposal)
			}
			if got := localMinute(proposal.ScheduledAt, location); got != test.start {
				t.Fatalf("start = %q, want %q", got, test.start)
			}
			if got := localMinute(proposal.ScheduledEndAt, location); got != test.end {
				t.Fatalf("end = %q, want %q", got, test.end)
			}
			if proposal.ScheduledDate != test.startDate || proposal.ScheduledEndDate != test.endDate {
				t.Fatalf("date range = %q–%q, want %q–%q", proposal.ScheduledDate, proposal.ScheduledEndDate, test.startDate, test.endDate)
			}
			if proposal.RecurrenceRule != test.recurrence {
				t.Fatalf("recurrence = %q, want %q", proposal.RecurrenceRule, test.recurrence)
			}
		})
	}
}

func localMinute(value *time.Time, location *time.Location) string {
	if value == nil {
		return ""
	}
	return value.In(location).Format("2006-01-02T15:04")
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
	if proposal.ScheduledAt != nil || len(proposal.Highlights) != 0 || !proposal.NeedsReview {
		t.Fatalf("note fallback should remain unchanged and enter Inbox: %#v", proposal)
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
		{"Idea: move the plants into the office", KindNote, "move the plants into the office"},
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
			if test.kind == KindNote && proposal.NeedsReview {
				t.Fatalf("explicit note proposal unexpectedly requires review: %#v", proposal)
			}
		})
	}
}

func TestParserStripsNaturalLanguageCommandPreambles(t *testing.T) {
	location := mustLocation(t, "America/Los_Angeles")
	parser := NewParser(location)
	now := time.Date(2026, time.January, 5, 10, 0, 0, 0, location)
	tests := []struct {
		text  string
		kind  Kind
		title string
	}{
		{"Remind me about D&D tomorrow at 7pm", KindReminder, "D&D"},
		{"Remind meabout D&D tomorrow at 7pm", KindReminder, "D&D"},
		{"Could you please remind me to call Mom tomorrow at 7pm", KindReminder, "call Mom"},
		{"Please schedule an event for D&D tomorrow at 7pm", KindEvent, "D&D"},
		{"Create an event called design review tomorrow at 7pm", KindEvent, "design review"},
	}
	for _, test := range tests {
		t.Run(test.text, func(t *testing.T) {
			proposal := parser.Parse(test.text, now)
			if proposal.Kind != test.kind || proposal.Title != test.title {
				t.Fatalf("proposal = %#v, want kind %q title %q", proposal, test.kind, test.title)
			}
			if proposal.ScheduledAt == nil {
				t.Fatal("ScheduledAt = nil, want tomorrow at 7 PM")
			}
			scheduled := proposal.ScheduledAt.In(location)
			if scheduled.Year() != 2026 || scheduled.Month() != time.January || scheduled.Day() != 6 ||
				scheduled.Hour() != 19 || scheduled.Minute() != 0 {
				t.Fatalf("ScheduledAt = %v, want 2026-01-06 19:00 local", scheduled)
			}
		})
	}
}

func TestParserRecognizesNaturalFactAndActivityExamples(t *testing.T) {
	location := mustLocation(t, "America/Los_Angeles")
	parser := NewParser(location)
	now := time.Date(2026, time.January, 5, 10, 0, 0, 0, location)

	fact := parser.Parse("Sam likes Ethiopian food", now)
	if fact.Kind != KindFact || fact.Subject != "Sam" || fact.Title != "likes Ethiopian food" || fact.NeedsReview {
		t.Fatalf("fact proposal = %#v", fact)
	}

	activity := parser.Parse("I gymmed today", now)
	if activity.Kind != KindActivity || activity.Title != "Gym" || activity.OccurredDate != "2026-01-05" {
		t.Fatalf("activity proposal = %#v", activity)
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
