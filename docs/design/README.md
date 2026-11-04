# Home screen design

The chosen design for the command center home screen, after five rounds of prototypes and two independent design reviews.
All rounds live on the design canvas: https://claude.ai/artifact/UfZhR2WaR4YVkhaPHHsVv3

- `home-desktop.dc.html`: desktop, 1440 wide
- `home-phone.dc.html`: phone, 390 wide

The data in both files is made up.

| Desktop, Day | Desktop, Week |
|---|---|
| ![Desktop, Day view](images/desktop-day.png) | ![Desktop, Week view](images/desktop-week.png) |

| Phone, Day | Phone, Week |
|---|---|
| ![Phone, Day view](images/phone-day.png) | ![Phone, Week view](images/phone-week.png) |

The screenshots are rendered from the `.dc.html` files with sample data.

## Layout, top to bottom

1. **Focus.** Sized to its content so the calendar starts on the first screen.
   - Date and time, then one sentence. The sentence gives judgement and the next action ("Standup at 10:00. Recovery is below your usual, so keep today easy.") and does not repeat the numbers.
   - Four snapshot numbers: recovery, sleep score, HRV and resting HR. Each shows its change from baseline right next to its name.
   - The next event, with a Join button. No free-time list: the gaps are visible on the timeline.
2. **Calendar and tasks.** A Day/Week toggle.
   - Day: a timeline from an hour before now to 22:00, with a red line for now. Events are blocks; the next event is a little brighter. Events under about 50 minutes take one line: title, start time and detail, cut with an ellipsis. Timed tasks (`⏰ HH:MM`) are reminders, drawn as dashed pills at their time in a lane to the right of the events.
   - Week: a rolling week from today. On desktop it has seven columns, with dated tasks at the top of each column. On the phone it is a strip of tappable days, then the agenda for the chosen day. Reminders have hollow markers and events have filled ones.
   - Task list with a quick-add box, grouped into Overdue, Today, This week and Someday. It is a side column on desktop and its own section on the phone.
3. **Health trends.** A 2W/1M/3M/1Y range switch, with the date range shown once next to the heading, then "Synced 14:02" (the newest strap sample). Past two hours it reads "Synced 5h ago" in orange; on the phone it takes its own line.

## One home per item

- Anything with a time today lives on the timeline only.
- Anything without a time lives in the task list only. There is no all-day chip row.
- Overdue items appear in the task list, plus at most one mention in the sentence.
- The week view shows dated tasks as hollow markers that cannot be ticked. Ticking happens in the task list.

## Health numbers

- **Time basis.** Snapshot metrics (recovery, HRV, resting HR, sleep, breathing rate, skin temperature) show this morning's value. Cumulative metrics (strain, steps, zone 2+) show yesterday's completed day, marked "· yesterday". Today's partial totals never feed a comparison.
- **Change.** The 7-day mean against a baseline: the 60 days before those 7. It is shown as a percentage, except skin temperature, which is shown in °C because a percentage of a temperature means nothing. The range switch changes only the chart, never the number. The focus row and the Health section read the same value.
- **Colour of the change.** Green when it is good for you and red when it is bad. Up is good for recovery, HRV, sleep score, time asleep, steps and zone 2+, and down is good for resting HR. It is grey when the change is under half a standard deviation of the baseline, so normal day-to-day noise stays grey. It is always grey for strain, breathing rate and skin temperature.
- **Charts.** Each metric has a fixed y-range of baseline ± 3 SD, so a small drift looks small. A shaded band shows the normal range (baseline ± 1 SD). The line is the 7-day rolling mean and each day is a faint dot. 1Y shows weekly means.
- **Order.** Heart (recovery, HRV, resting HR), sleep (sleep score, time asleep), activity (strain, steps, zone 2+), vitals (breathing rate, skin temperature). Groups are separated by extra space, not labels.

## Look

Dark mode only for now (`color-scheme: dark`). Colours are Apple's dark-mode system colours.

**Neutrals**

| Token | Hex | Use |
|---|---|---|
| background | `#0C0C0E` | page |
| text | `#F5F5F7` | primary text |
| text-2 | `#A1A1A6` | labels, past event titles |
| text-3 | `#8E8E93` | dimmest text allowed (about 6:1 on the background) |
| fill | `#1C1C1E` | segmented control track, quick-add field, buttons |
| line-2 | `#2C2C2E` | dividers and hour lines |
| line-3 | `#3A3A3C` | button outlines, reminder guide lines |
| control | `#636366` | selected segment, checkbox rings, reminder outlines; never text |

Past items are dimmed by switching to text-2 and text-3 and lowering the fill alpha, never with opacity.

**Status.** These colours carry meaning and are never used for categories.

| Token | Hex | Use |
|---|---|---|
| good | `#30D158` | recovery 67 to 100, good change |
| caution | `#FFD60A` | recovery 34 to 66 |
| bad | `#FF453A` | recovery 0 to 33, bad change |
| warn | `#FF9F0A` | overdue tasks |
| now | `#FF453A` | the current-time line (same as Apple Calendar) |

Recovery is coloured by band only in the focus row, and its number is always shown next to the colour. The sentence is plain text with no colour.

**Calendar categories.** None of these hues are status colours.

| Token | Hex | Use |
|---|---|---|
| work | `#0A84FF` | work events |
| fitness | `#40C8E0` | gym, runs, physio |
| personal | `#BF5AF2` | social and personal events |
| focus | `#8E8E93` | focus blocks |

**Health categories.** One line colour per group, the way Apple Health does it.

| Token | Hex | Metrics |
|---|---|---|
| heart | `#FF7EB6` | recovery, HRV, resting HR |
| sleep | `#7D7AFF` | sleep score, time asleep |
| activity | `#64D2FF` | strain, steps, zone 2+ |
| vitals | `#AC8E68` | breathing rate, skin temperature |

**Controls**

- Segmented controls: `#1C1C1E` track, `#636366` selected segment with white text.
- Checkboxes: 1.5 px `#636366` rings that fill when done. A done item always shows a filled ring, not only a strike-through.
- Touch targets are at least 44 px on the phone. Rows in the task list are the hit area.

**Type and formats**

- System font (SF Pro on Apple). Weight 200 only at 48 px and above, 300 for 24 to 40 px. Tabular figures throughout.
- Secondary sizes: 11, 13, 15 and 17 px.
- Day-month dates ("3 Nov"), 24-hour times, durations as "7h 12m", lateness as "3d late".
- No cards or boxes on the main sections. Hairline dividers and spacing do the grouping. No explanatory labels.

## Not done yet

- Sorting health rows so that metrics outside their normal band come first.
- A strain target for the day, based on recovery, in place of strain so far.

## Files

These are Claude Design components (`.dc.html`). Each renders on the canvas and has the layout and the sample data in one file, so they are a reference for building the real UI rather than code to ship.
