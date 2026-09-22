package capture

import (
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type Kind string

const (
	KindReminder Kind = "reminder"
	KindEvent    Kind = "event"
	KindNote     Kind = "note"
	KindFact     Kind = "fact"
	KindActivity Kind = "activity"
)

type Highlight struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	Kind  string `json:"kind"`
	Label string `json:"label"`
}

type Proposal struct {
	Kind              Kind        `json:"kind"`
	Title             string      `json:"title"`
	Subject           string      `json:"subject,omitempty"`
	ScheduledAt       *time.Time  `json:"scheduled_at,omitempty"`
	ScheduledDate     string      `json:"scheduled_date,omitempty"`
	OccurredDate      string      `json:"occurred_date,omitempty"`
	ScheduledTimezone string      `json:"scheduled_timezone,omitempty"`
	AllDay            bool        `json:"all_day,omitempty"`
	DisplayWhen       string      `json:"display_when,omitempty"`
	Place             string      `json:"place,omitempty"`
	NeedsReview       bool        `json:"needs_review"`
	Highlights        []Highlight `json:"highlights"`
}

type Parser struct {
	location *time.Location
}

var (
	reminderPrefixPattern = regexp.MustCompile(`(?i)^\s*(?:remind\s+me\s+(?:to|that)|remember\s+to|don'?t\s+forget\s+to|task\s*:|todo\s*:|reminder\s*:)\s*`)
	eventPrefixPattern    = regexp.MustCompile(`(?i)^\s*(?:event\s*:|calendar\s*:|schedule(?:\s+an?\s+event)?\s+)\s*`)
	notePrefixPattern     = regexp.MustCompile(`(?i)^\s*(?:note|idea)\s*:\s*`)
	factPrefixPattern     = regexp.MustCompile(`(?i)^\s*fact\s*:\s*`)
	activityPrefixPattern = regexp.MustCompile(`(?i)^\s*(?:activity|log)\s*:\s*`)
	factPattern           = regexp.MustCompile(`^\s*([[:upper:]][[:alpha:]'-]*(?:\s+[[:upper:]][[:alpha:]'-]*)?)\s+((?:likes|loves|prefers|dislikes|hates)\b.+?)\s*$`)
	activityPattern       = regexp.MustCompile(`(?i)^\s*i\s+(gymmed|worked\s+out|ran|walked|cycled|swam)(?:\s+(today|yesterday))?\s*$`)
	timePattern           = regexp.MustCompile(`(?i)(?:\bat\s+|@\s*)([0-9]{1,2})(?::([0-9]{2}))?(?:\s*(a\.?m\.?|p\.?m\.?))?`)
	datePattern           = regexp.MustCompile(`(?i)(?:\b(?:on|this|next)\s+)?\b(today|tonight|tomorrow|yesterday|mon(?:day)?|tue(?:sday)?|wed(?:nesday|ensday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b`)
	placePattern          = regexp.MustCompile(`(?i)\b(?:at|in)\s+([[:alpha:]][[:alnum:] .'-]{0,59})\s*$`)
)

func NewParser(location *time.Location) *Parser {
	return &Parser{location: location}
}

func (parser *Parser) Parse(text string, now time.Time) Proposal {
	proposal := Proposal{
		Kind:       KindNote,
		Title:      strings.TrimSpace(text),
		Highlights: []Highlight{},
	}
	if proposal.Title == "" {
		return proposal
	}

	var removed [][2]int
	explicitIntent := false
	if match := reminderPrefixPattern.FindStringIndex(text); match != nil {
		proposal.Kind = KindReminder
		explicitIntent = true
		removed = append(removed, [2]int{match[0], match[1]})
		proposal.Highlights = append(proposal.Highlights, highlight(text, match, "intent", "Reminder"))
	} else if match := eventPrefixPattern.FindStringIndex(text); match != nil {
		proposal.Kind = KindEvent
		explicitIntent = true
		removed = append(removed, [2]int{match[0], match[1]})
		proposal.Highlights = append(proposal.Highlights, highlight(text, match, "intent", "Event"))
	} else if match := notePrefixPattern.FindStringIndex(text); match != nil {
		explicitIntent = true
		removed = append(removed, [2]int{match[0], match[1]})
		proposal.Highlights = append(proposal.Highlights, highlight(text, match, "intent", "Note"))
	} else if match := factPrefixPattern.FindStringIndex(text); match != nil {
		proposal.Kind = KindFact
		explicitIntent = true
		removed = append(removed, [2]int{match[0], match[1]})
		proposal.Highlights = append(proposal.Highlights, highlight(text, match, "intent", "Fact"))
	} else if match := activityPrefixPattern.FindStringIndex(text); match != nil {
		proposal.Kind = KindActivity
		explicitIntent = true
		removed = append(removed, [2]int{match[0], match[1]})
		proposal.Highlights = append(proposal.Highlights, highlight(text, match, "intent", "Activity"))
	} else if match := factPattern.FindStringSubmatchIndex(text); match != nil {
		proposal.Kind = KindFact
		proposal.Subject = strings.TrimSpace(text[match[2]:match[3]])
		proposal.Title = strings.TrimSpace(text[match[4]:match[5]])
		return proposal
	} else if match := activityPattern.FindStringSubmatchIndex(text); match != nil {
		proposal.Kind = KindActivity
		proposal.Title = activityTitle(text[match[2]:match[3]])
		dateName := "today"
		if match[4] >= 0 {
			dateName = text[match[4]:match[5]]
			proposal.Highlights = append(proposal.Highlights, highlight(text, match[4:6], "date", "Date"))
		}
		day := resolveAllDay(dateName, now.In(parser.location))
		proposal.OccurredDate = day.Format(time.DateOnly)
		proposal.ScheduledTimezone = parser.location.String()
		proposal.DisplayWhen = day.Format("Mon, Jan 2")
		return proposal
	}

	timeMatch := timePattern.FindStringSubmatchIndex(text)
	timeIsValid := false
	if timeMatch != nil {
		_, _, timeIsValid = parseClock(text, timeMatch)
	}
	if proposal.Kind == KindNote && !explicitIntent && timeIsValid {
		proposal.Kind = KindEvent
	}
	if proposal.Kind == KindNote {
		proposal.Title = cleanTitle(text, removed)
		proposal.NeedsReview = !explicitIntent
		return proposal
	}
	if proposal.Kind == KindFact {
		proposal.Title = cleanTitle(text, removed)
		proposal.NeedsReview = proposal.Subject == ""
		return proposal
	}

	var hour, minute int
	hasTime := false
	if proposal.Kind != KindActivity && timeMatch != nil {
		if parsedHour, parsedMinute, ok := parseClock(text, timeMatch); ok {
			hour, minute, hasTime = parsedHour, parsedMinute, true
			span := [2]int{timeMatch[0], timeMatch[1]}
			removed = append(removed, span)
			proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "time", "Time"))
		}
	}

	var dateName string
	if match := datePattern.FindStringSubmatchIndex(text); match != nil {
		dateName = text[match[2]:match[3]]
		span := [2]int{match[0], match[1]}
		removed = append(removed, span)
		proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "date", "Date"))
	}

	if proposal.Kind != KindActivity {
		if match := placePattern.FindStringSubmatchIndex(text); match != nil {
			proposal.Place = strings.TrimSpace(text[match[2]:match[3]])
			span := [2]int{match[0], match[1]}
			removed = append(removed, span)
			proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "place", "Place"))
		}
	}

	proposal.Title = cleanTitle(text, removed)
	if proposal.Title == "" {
		proposal.Title = strings.TrimSpace(text)
	}
	localNow := now.In(parser.location)
	if proposal.Kind == KindActivity {
		day := resolveAllDay(dateName, localNow)
		proposal.OccurredDate = day.Format(time.DateOnly)
		proposal.ScheduledTimezone = parser.location.String()
		proposal.DisplayWhen = day.Format("Mon, Jan 2")
	} else if hasTime {
		day := resolveDay(dateName, localNow, hour, minute)
		localScheduled := time.Date(day.Year(), day.Month(), day.Day(), hour, minute, 0, 0, parser.location)
		utcScheduled := localScheduled.UTC()
		proposal.ScheduledAt = &utcScheduled
		proposal.ScheduledTimezone = parser.location.String()
		proposal.DisplayWhen = localScheduled.Format("Mon, Jan 2 · 3:04 PM")
	} else if dateName != "" {
		day := resolveAllDay(dateName, localNow)
		proposal.ScheduledDate = day.Format(time.DateOnly)
		proposal.ScheduledTimezone = parser.location.String()
		proposal.AllDay = true
		proposal.DisplayWhen = day.Format("Mon, Jan 2") + " · all day"
	}

	sort.Slice(proposal.Highlights, func(i, j int) bool {
		return proposal.Highlights[i].Start < proposal.Highlights[j].Start
	})
	return proposal
}

func activityTitle(verb string) string {
	switch strings.ToLower(strings.Join(strings.Fields(verb), " ")) {
	case "gymmed", "worked out":
		return "Gym"
	case "ran":
		return "Run"
	case "walked":
		return "Walk"
	case "cycled":
		return "Cycling"
	case "swam":
		return "Swim"
	default:
		return strings.TrimSpace(verb)
	}
}

func parseClock(text string, match []int) (int, int, bool) {
	hour, ok := parseDecimal(text[match[2]:match[3]])
	if !ok {
		return 0, 0, false
	}
	minute := 0
	if match[4] >= 0 {
		minute, ok = parseDecimal(text[match[4]:match[5]])
		if !ok || minute > 59 {
			return 0, 0, false
		}
	}
	meridiem := ""
	if match[6] >= 0 {
		meridiem = strings.NewReplacer(".", "", " ", "").Replace(strings.ToLower(text[match[6]:match[7]]))
	}
	if meridiem != "" {
		if hour < 1 || hour > 12 {
			return 0, 0, false
		}
		if hour == 12 {
			hour = 0
		}
		if meridiem == "pm" {
			hour += 12
		}
	} else {
		if hour > 23 {
			return 0, 0, false
		}
		if hour >= 1 && hour <= 7 {
			hour += 12
		}
	}
	return hour, minute, true
}

func parseDecimal(value string) (int, bool) {
	result := 0
	if value == "" {
		return 0, false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return 0, false
		}
		result = result*10 + int(character-'0')
	}
	return result, true
}

func resolveDay(name string, now time.Time, hour, minute int) time.Time {
	candidate := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, 0, 0, now.Location())
	switch strings.ToLower(name) {
	case "today":
		return candidate
	case "yesterday":
		return candidate.AddDate(0, 0, -1)
	case "tomorrow":
		return candidate.AddDate(0, 0, 1)
	case "mon", "monday":
		return nextWeekday(candidate, now, time.Monday)
	case "tue", "tuesday":
		return nextWeekday(candidate, now, time.Tuesday)
	case "wed", "wednesday", "wedensday":
		return nextWeekday(candidate, now, time.Wednesday)
	case "thu", "thursday":
		return nextWeekday(candidate, now, time.Thursday)
	case "fri", "friday":
		return nextWeekday(candidate, now, time.Friday)
	case "sat", "saturday":
		return nextWeekday(candidate, now, time.Saturday)
	case "sun", "sunday":
		return nextWeekday(candidate, now, time.Sunday)
	default:
		if !candidate.After(now) {
			return candidate.AddDate(0, 0, 1)
		}
		return candidate
	}
}

func resolveAllDay(name string, now time.Time) time.Time {
	candidate := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	switch strings.ToLower(name) {
	case "today", "tonight":
		return candidate
	case "yesterday":
		return candidate.AddDate(0, 0, -1)
	case "tomorrow":
		return candidate.AddDate(0, 0, 1)
	case "mon", "monday":
		return allDayWeekday(candidate, now, time.Monday)
	case "tue", "tuesday":
		return allDayWeekday(candidate, now, time.Tuesday)
	case "wed", "wednesday", "wedensday":
		return allDayWeekday(candidate, now, time.Wednesday)
	case "thu", "thursday":
		return allDayWeekday(candidate, now, time.Thursday)
	case "fri", "friday":
		return allDayWeekday(candidate, now, time.Friday)
	case "sat", "saturday":
		return allDayWeekday(candidate, now, time.Saturday)
	case "sun", "sunday":
		return allDayWeekday(candidate, now, time.Sunday)
	default:
		return candidate
	}
}

func allDayWeekday(candidate, now time.Time, weekday time.Weekday) time.Time {
	days := (int(weekday) - int(now.Weekday()) + 7) % 7
	return candidate.AddDate(0, 0, days)
}

func nextWeekday(candidate, now time.Time, weekday time.Weekday) time.Time {
	days := (int(weekday) - int(now.Weekday()) + 7) % 7
	candidate = candidate.AddDate(0, 0, days)
	if !candidate.After(now) {
		candidate = candidate.AddDate(0, 0, 7)
	}
	return candidate
}

func cleanTitle(text string, removed [][2]int) string {
	if len(removed) == 0 {
		return strings.TrimSpace(text)
	}
	sort.Slice(removed, func(i, j int) bool { return removed[i][0] < removed[j][0] })
	var builder strings.Builder
	cursor := 0
	for _, span := range removed {
		if span[0] < cursor {
			continue
		}
		builder.WriteString(text[cursor:span[0]])
		builder.WriteByte(' ')
		cursor = span[1]
	}
	builder.WriteString(text[cursor:])
	title := strings.Join(strings.Fields(builder.String()), " ")
	title = strings.Trim(title, " \t\r\n,.;:-")
	return title
}

func highlight(text string, span []int, kind, label string) Highlight {
	return Highlight{
		Start: utf8.RuneCountInString(text[:span[0]]),
		End:   utf8.RuneCountInString(text[:span[1]]),
		Kind:  kind,
		Label: label,
	}
}
