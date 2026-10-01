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
	ScheduledEndAt    *time.Time  `json:"scheduled_end_at,omitempty"`
	ScheduledDate     string      `json:"scheduled_date,omitempty"`
	ScheduledEndDate  string      `json:"scheduled_end_date,omitempty"`
	OccurredDate      string      `json:"occurred_date,omitempty"`
	ScheduledTimezone string      `json:"scheduled_timezone,omitempty"`
	AllDay            bool        `json:"all_day,omitempty"`
	DisplayWhen       string      `json:"display_when,omitempty"`
	Place             string      `json:"place,omitempty"`
	RecurrenceRule    string      `json:"recurrence_rule,omitempty"`
	NeedsReview       bool        `json:"needs_review"`
	Highlights        []Highlight `json:"highlights"`
}

type Parser struct {
	location *time.Location
}

var (
	reminderPrefixPattern  = regexp.MustCompile(`(?i)^\s*(?:(?:please|(?:can|could|would)\s+you)\s+)*(?:remind\s*me(?:(?:\s*(?:to|that|about)\b)\s*|\s+)|remember(?:\s+(?:to|about))?\s+|don'?t\s+forget(?:\s+(?:to|about))?\s+|task\s*:|todo\s*:|reminder\s*:)\s*`)
	eventPrefixPattern     = regexp.MustCompile(`(?i)^\s*(?:(?:please|(?:can|could|would)\s+you)\s+)*(?:event\s*:|calendar\s*:|schedule\b(?:\s+(?:an?\s+)?event)?(?:\s+(?:for|called))?|(?:add|create)\s+(?:an?\s+)?event(?:\s+(?:for|called))?\s*:?)\s*`)
	calendarCommandPattern = regexp.MustCompile(`(?i)^\s*put\s+(.+?)\s+on\s+my\s+calendar\s+for\s+(.+?)\s*$`)
	notePrefixPattern      = regexp.MustCompile(`(?i)^\s*(?:note|idea)\s*:\s*`)
	factPrefixPattern      = regexp.MustCompile(`(?i)^\s*fact\s*:\s*`)
	activityPrefixPattern  = regexp.MustCompile(`(?i)^\s*(?:activity|log)\s*:\s*`)
	factPattern            = regexp.MustCompile(`^\s*([[:upper:]][[:alpha:]'-]*(?:\s+[[:upper:]][[:alpha:]'-]*)?)\s+((?:likes|loves|prefers|dislikes|hates)\b.+?)\s*$`)
	activityPattern        = regexp.MustCompile(`(?i)^\s*i\s+(gymmed|worked\s+out|ran|walked|cycled|swam)(?:\s+(today|yesterday))?\s*$`)
	timePattern            = regexp.MustCompile(`(?i)(?:\bat\s+|@\s*)([0-9]{1,2})(?::([0-9]{2}))?(?:\s*(a\.?m\.?|p\.?m\.?))?`)
	namedTimePattern       = regexp.MustCompile(`(?i)\bat\s+(noon|midnight)\b`)
	timeRangePattern       = regexp.MustCompile(`(?i)\bfrom\s+([0-9]{1,2})(?::([0-9]{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s+(?:to|-)\s+([0-9]{1,2})(?::([0-9]{2}))?\s*(a\.?m\.?|p\.?m\.?)?`)
	compactRangePattern    = regexp.MustCompile(`(?i)(?:\bat\s+)?([0-9]{1,2})(?::([0-9]{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*[-–]\s*([0-9]{1,2})(?::([0-9]{2}))?\s*(a\.?m\.?|p\.?m\.?)?`)
	durationPattern        = regexp.MustCompile(`(?i)\bfor\s+([0-9]+)\s*(minutes?|mins?|hours?|hrs?)\b`)
	relativeTimePattern    = regexp.MustCompile(`(?i)\bin\s+([0-9]+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b(?:\s+to\b\s*)?`)
	datePattern            = regexp.MustCompile(`(?i)(?:\b(?:on|by|this|next)\s+)?\b(today|tonight|tomorrow|yesterday|mon(?:day)?|tue(?:sday)?|wed(?:nesday|ensday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b`)
	absoluteDatePattern    = regexp.MustCompile(`(?i)(?:\b(?:on|by)\s+)?\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+([0-9]{1,2})(?:st|nd|rd|th)?(?:,\s*([0-9]{4}))?\b`)
	dateRangePattern       = regexp.MustCompile(`(?i)\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+([0-9]{1,2})(?:st|nd|rd|th)?\s+(?:through|to|-)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+([0-9]{1,2})(?:st|nd|rd|th)?(?:,\s*([0-9]{4}))?\b`)
	recurrencePattern      = regexp.MustCompile(`(?i)\bevery\s+(mon(?:day)?|tue(?:sday)?|wed(?:nesday|ensday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b`)
	placePrefixPattern     = regexp.MustCompile(`(?i)\b(?:at|in|via)\s+`)
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
	if match := calendarCommandPattern.FindStringSubmatchIndex(text); match != nil {
		proposal.Kind = KindEvent
		explicitIntent = true
		prefix := [2]int{match[0], match[2]}
		connector := [2]int{match[3], match[4]}
		removed = append(removed, prefix, connector)
		proposal.Highlights = append(proposal.Highlights, highlight(text, prefix[:], "intent", "Event"))
	} else if match := reminderPrefixPattern.FindStringIndex(text); match != nil {
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

	timeRangeMatch := timeRangePattern.FindStringSubmatchIndex(text)
	if timeRangeMatch == nil {
		timeRangeMatch = compactRangePattern.FindStringSubmatchIndex(text)
	}
	timeMatch := timePattern.FindStringSubmatchIndex(text)
	namedTimeMatch := namedTimePattern.FindStringSubmatchIndex(text)
	relativeTimeMatch := relativeTimePattern.FindStringSubmatchIndex(text)
	durationMatch := durationPattern.FindStringSubmatchIndex(text)
	dateRangeMatch := dateRangePattern.FindStringSubmatchIndex(text)
	recurrenceMatch := recurrencePattern.FindStringSubmatchIndex(text)
	var absoluteDateMatch, weekdayDateMatch []int
	if dateRangeMatch == nil && recurrenceMatch == nil {
		absoluteDateMatch = absoluteDatePattern.FindStringSubmatchIndex(text)
		if absoluteDateMatch == nil {
			weekdayDateMatch = datePattern.FindStringSubmatchIndex(text)
		}
	}

	temporalMatch := timeMatch
	timeIsValid := false
	if timeRangeMatch != nil {
		_, _, startValid := parseClockGroup(text, timeRangeMatch, 1)
		_, _, endValid := parseClockGroup(text, timeRangeMatch, 4)
		timeIsValid = startValid && endValid
		if timeIsValid {
			temporalMatch = timeRangeMatch
		}
	} else if namedTimeMatch != nil {
		timeIsValid = true
		temporalMatch = namedTimeMatch
	} else if timeMatch != nil {
		_, _, timeIsValid = parseClock(text, timeMatch)
	} else if relativeTimeMatch != nil {
		_, timeIsValid = parseRelativeDuration(text, relativeTimeMatch)
		temporalMatch = relativeTimeMatch
	}
	deadline := matchStartsWith(text, absoluteDateMatch, "by") || matchStartsWith(text, weekdayDateMatch, "by")
	if proposal.Kind == KindNote && !explicitIntent {
		switch {
		case relativeTimeMatch != nil && timeIsValid, deadline:
			proposal.Kind = KindReminder
		case timeIsValid, dateRangeMatch != nil, recurrenceMatch != nil:
			proposal.Kind = KindEvent
		}
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

	var hour, minute, endHour, endMinute int
	hasTime := false
	hasEndTime := false
	if proposal.Kind != KindActivity && timeRangeMatch != nil {
		parsedHour, parsedMinute, startOK := parseClockGroup(text, timeRangeMatch, 1)
		parsedEndHour, parsedEndMinute, endOK := parseClockGroup(text, timeRangeMatch, 4)
		if startOK && endOK {
			hour, minute, endHour, endMinute = parsedHour, parsedMinute, parsedEndHour, parsedEndMinute
			hasTime, hasEndTime = true, true
			span := [2]int{timeRangeMatch[0], timeRangeMatch[1]}
			removed = append(removed, span)
			proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "time", "Time range"))
		}
	} else if proposal.Kind != KindActivity && namedTimeMatch != nil {
		hour, minute, hasTime = namedClock(text[namedTimeMatch[2]:namedTimeMatch[3]])
		span := [2]int{namedTimeMatch[0], namedTimeMatch[1]}
		removed = append(removed, span)
		proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "time", "Time"))
	} else if proposal.Kind != KindActivity && timeMatch != nil {
		if parsedHour, parsedMinute, ok := parseClock(text, timeMatch); ok {
			hour, minute, hasTime = parsedHour, parsedMinute, true
			span := [2]int{timeMatch[0], timeMatch[1]}
			removed = append(removed, span)
			proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "time", "Time"))
		}
	}

	var relativeDuration time.Duration
	hasRelativeTime := false
	if proposal.Kind != KindActivity && relativeTimeMatch != nil {
		if parsed, ok := parseRelativeDuration(text, relativeTimeMatch); ok {
			relativeDuration, hasRelativeTime = parsed, true
			span := [2]int{relativeTimeMatch[0], relativeTimeMatch[1]}
			removed = append(removed, span)
			proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "time", "Relative time"))
		}
	}

	var eventDuration time.Duration
	if proposal.Kind == KindEvent && hasTime && durationMatch != nil {
		if parsed, ok := parseClockDuration(text, durationMatch); ok {
			eventDuration = parsed
			span := [2]int{durationMatch[0], durationMatch[1]}
			removed = append(removed, span)
			proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "time", "Duration"))
		}
	}

	localNow := now.In(parser.location)
	var scheduledDay time.Time
	hasScheduledDay := false
	if dateRangeMatch != nil {
		startDate, endDate, ok := parseDateRange(text, dateRangeMatch, localNow)
		if ok {
			proposal.ScheduledDate = startDate.Format(time.DateOnly)
			proposal.ScheduledEndDate = endDate.AddDate(0, 0, 1).Format(time.DateOnly)
			proposal.AllDay = true
			proposal.ScheduledTimezone = parser.location.String()
			proposal.DisplayWhen = startDate.Format("Mon, Jan 2") + "–" + endDate.Format("Mon, Jan 2")
			span := [2]int{dateRangeMatch[0], dateRangeMatch[1]}
			removed = append(removed, span)
			proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "date", "Date range"))
		}
	} else if absoluteDateMatch != nil {
		if day, ok := parseAbsoluteDate(text, absoluteDateMatch, localNow); ok {
			scheduledDay, hasScheduledDay = day, true
			span := [2]int{absoluteDateMatch[0], absoluteDateMatch[1]}
			removed = append(removed, span)
			proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "date", "Date"))
		}
	} else if recurrenceMatch != nil {
		dateName := text[recurrenceMatch[2]:recurrenceMatch[3]]
		scheduledDay, hasScheduledDay = resolveDay(dateName, localNow, hour, minute), true
		proposal.RecurrenceRule = "FREQ=WEEKLY;BYDAY=" + recurrenceWeekday(dateName)
		span := [2]int{recurrenceMatch[0], recurrenceMatch[1]}
		removed = append(removed, span)
		proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "date", "Weekly recurrence"))
	} else if weekdayDateMatch != nil {
		dateName := text[weekdayDateMatch[2]:weekdayDateMatch[3]]
		scheduledDay, hasScheduledDay = resolveDay(dateName, localNow, hour, minute), true
		span := [2]int{weekdayDateMatch[0], weekdayDateMatch[1]}
		removed = append(removed, span)
		proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "date", "Date"))
	}

	if proposal.Kind != KindActivity {
		if place, span, ok := findPlace(text, temporalMatch); ok {
			proposal.Place = place
			removed = append(removed, span)
			proposal.Highlights = append(proposal.Highlights, highlight(text, span[:], "place", "Place"))
		}
	}

	proposal.Title = cleanTitle(text, removed)
	if proposal.Title == "" {
		proposal.Title = strings.TrimSpace(text)
	}
	if proposal.Kind == KindActivity {
		day := resolveAllDay("", localNow)
		if hasScheduledDay {
			day = scheduledDay
		}
		proposal.OccurredDate = day.Format(time.DateOnly)
		proposal.ScheduledTimezone = parser.location.String()
		proposal.DisplayWhen = day.Format("Mon, Jan 2")
	} else if hasRelativeTime {
		localScheduled := localNow.Add(relativeDuration)
		utcScheduled := localScheduled.UTC()
		proposal.ScheduledAt = &utcScheduled
		proposal.ScheduledTimezone = parser.location.String()
		proposal.DisplayWhen = localScheduled.Format("Mon, Jan 2 · 3:04 PM")
	} else if hasTime {
		day := localNow
		if hasScheduledDay {
			day = scheduledDay
		}
		localScheduled := time.Date(day.Year(), day.Month(), day.Day(), hour, minute, 0, 0, parser.location)
		if !hasScheduledDay && !localScheduled.After(localNow) {
			localScheduled = localScheduled.AddDate(0, 0, 1)
		}
		utcScheduled := localScheduled.UTC()
		proposal.ScheduledAt = &utcScheduled
		proposal.ScheduledTimezone = parser.location.String()
		proposal.DisplayWhen = localScheduled.Format("Mon, Jan 2 · 3:04 PM")
		if hasEndTime {
			localEnd := time.Date(day.Year(), day.Month(), day.Day(), endHour, endMinute, 0, 0, parser.location)
			if !localEnd.After(localScheduled) {
				localEnd = localEnd.AddDate(0, 0, 1)
			}
			utcEnd := localEnd.UTC()
			proposal.ScheduledEndAt = &utcEnd
			proposal.DisplayWhen += "–" + localEnd.Format("3:04 PM")
		} else if eventDuration > 0 {
			localEnd := localScheduled.Add(eventDuration)
			utcEnd := localEnd.UTC()
			proposal.ScheduledEndAt = &utcEnd
			proposal.DisplayWhen += "–" + localEnd.Format("3:04 PM")
		}
		if proposal.RecurrenceRule != "" {
			proposal.DisplayWhen += " · weekly"
		}
	} else if hasScheduledDay {
		proposal.ScheduledDate = scheduledDay.Format(time.DateOnly)
		proposal.ScheduledTimezone = parser.location.String()
		proposal.AllDay = true
		proposal.DisplayWhen = scheduledDay.Format("Mon, Jan 2") + " · all day"
	}

	sort.Slice(proposal.Highlights, func(i, j int) bool {
		return proposal.Highlights[i].Start < proposal.Highlights[j].Start
	})
	return proposal
}

func matchStartsWith(text string, match []int, prefix string) bool {
	if match == nil {
		return false
	}
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(text[match[0]:match[1]])), prefix)
}

func namedClock(value string) (int, int, bool) {
	switch strings.ToLower(value) {
	case "noon":
		return 12, 0, true
	case "midnight":
		return 0, 0, true
	default:
		return 0, 0, false
	}
}

func parseRelativeDuration(text string, match []int) (time.Duration, bool) {
	amount, ok := parseDecimal(text[match[2]:match[3]])
	if !ok || amount < 1 {
		return 0, false
	}
	switch strings.ToLower(text[match[4]:match[5]]) {
	case "minute", "minutes", "min", "mins":
		return time.Duration(amount) * time.Minute, true
	case "hour", "hours", "hr", "hrs":
		return time.Duration(amount) * time.Hour, true
	case "day", "days":
		return time.Duration(amount) * 24 * time.Hour, true
	case "week", "weeks":
		return time.Duration(amount) * 7 * 24 * time.Hour, true
	default:
		return 0, false
	}
}

func parseClockDuration(text string, match []int) (time.Duration, bool) {
	amount, ok := parseDecimal(text[match[2]:match[3]])
	if !ok || amount < 1 {
		return 0, false
	}
	switch strings.ToLower(text[match[4]:match[5]]) {
	case "minute", "minutes", "min", "mins":
		return time.Duration(amount) * time.Minute, true
	case "hour", "hours", "hr", "hrs":
		return time.Duration(amount) * time.Hour, true
	default:
		return 0, false
	}
}

func parseAbsoluteDate(text string, match []int, now time.Time) (time.Time, bool) {
	month, ok := parseMonth(text[match[2]:match[3]])
	if !ok {
		return time.Time{}, false
	}
	day, ok := parseDecimal(text[match[4]:match[5]])
	if !ok {
		return time.Time{}, false
	}
	year := now.Year()
	explicitYear := match[6] >= 0
	if explicitYear {
		year, ok = parseDecimal(text[match[6]:match[7]])
		if !ok {
			return time.Time{}, false
		}
	}
	date := time.Date(year, month, day, 0, 0, 0, 0, now.Location())
	if date.Month() != month || date.Day() != day {
		return time.Time{}, false
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	if !explicitYear && date.Before(today) {
		date = time.Date(year+1, month, day, 0, 0, 0, 0, now.Location())
	}
	return date, true
}

func parseDateRange(text string, match []int, now time.Time) (time.Time, time.Time, bool) {
	startMonth, startOK := parseMonth(text[match[2]:match[3]])
	startDay, startDayOK := parseDecimal(text[match[4]:match[5]])
	endMonth, endOK := parseMonth(text[match[6]:match[7]])
	endDay, endDayOK := parseDecimal(text[match[8]:match[9]])
	if !startOK || !startDayOK || !endOK || !endDayOK {
		return time.Time{}, time.Time{}, false
	}
	year := now.Year()
	explicitYear := match[10] >= 0
	if explicitYear {
		var ok bool
		year, ok = parseDecimal(text[match[10]:match[11]])
		if !ok {
			return time.Time{}, time.Time{}, false
		}
	}
	start := time.Date(year, startMonth, startDay, 0, 0, 0, 0, now.Location())
	if start.Month() != startMonth || start.Day() != startDay {
		return time.Time{}, time.Time{}, false
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	if !explicitYear && start.Before(today) {
		start = time.Date(year+1, startMonth, startDay, 0, 0, 0, 0, now.Location())
		year++
	}
	end := time.Date(year, endMonth, endDay, 0, 0, 0, 0, now.Location())
	if !explicitYear && end.Before(start) {
		end = time.Date(year+1, endMonth, endDay, 0, 0, 0, 0, now.Location())
	}
	if end.Month() != endMonth || end.Day() != endDay || end.Before(start) {
		return time.Time{}, time.Time{}, false
	}
	return start, end, true
}

func parseMonth(value string) (time.Month, bool) {
	switch strings.ToLower(value[:3]) {
	case "jan":
		return time.January, true
	case "feb":
		return time.February, true
	case "mar":
		return time.March, true
	case "apr":
		return time.April, true
	case "may":
		return time.May, true
	case "jun":
		return time.June, true
	case "jul":
		return time.July, true
	case "aug":
		return time.August, true
	case "sep":
		return time.September, true
	case "oct":
		return time.October, true
	case "nov":
		return time.November, true
	case "dec":
		return time.December, true
	default:
		return 0, false
	}
}

func recurrenceWeekday(value string) string {
	switch strings.ToLower(value) {
	case "mon", "monday":
		return "MO"
	case "tue", "tuesday":
		return "TU"
	case "wed", "wednesday", "wedensday":
		return "WE"
	case "thu", "thursday":
		return "TH"
	case "fri", "friday":
		return "FR"
	case "sat", "saturday":
		return "SA"
	default:
		return "SU"
	}
}

func findPlace(text string, timeMatch []int) (string, [2]int, bool) {
	for _, match := range placePrefixPattern.FindAllStringIndex(text, -1) {
		if timeMatch != nil && match[0] < timeMatch[1] {
			continue
		}
		place := strings.TrimSpace(text[match[1]:])
		if place != "" {
			return place, [2]int{match[0], len(text)}, true
		}
	}
	return "", [2]int{}, false
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
	return parseClockGroup(text, match, 1)
}

func parseClockGroup(text string, match []int, group int) (int, int, bool) {
	hourIndex := group * 2
	minuteIndex := hourIndex + 2
	meridiemIndex := hourIndex + 4
	hour, ok := parseDecimal(text[match[hourIndex]:match[hourIndex+1]])
	if !ok {
		return 0, 0, false
	}
	minute := 0
	if match[minuteIndex] >= 0 {
		minute, ok = parseDecimal(text[match[minuteIndex]:match[minuteIndex+1]])
		if !ok || minute > 59 {
			return 0, 0, false
		}
	}
	meridiem := ""
	if match[meridiemIndex] >= 0 {
		meridiem = strings.NewReplacer(".", "", " ", "").Replace(strings.ToLower(text[match[meridiemIndex]:match[meridiemIndex+1]]))
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
