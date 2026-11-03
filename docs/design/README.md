# Home screen design

The chosen design for the command center home screen, after four rounds of prototypes.
All rounds live on the design canvas: https://claude.ai/artifact/UfZhR2WaR4YVkhaPHHsVv3

- `home-desktop.dc.html`: desktop, 1440 wide
- `home-phone.dc.html`: phone, 390 wide

The data in both files is made up.

## Layout, top to bottom

1. **Focus.** Date and time, one sentence that sums up the day, then four large numbers: recovery, sleep score, strain and HRV. A line under them counts events, reminders and overdue tasks, and lists free time.
2. **Calendar and tasks.** A Day/Week toggle.
   - Day: an hour timeline from 07 to 22 with a red line for now. Events are blocks. Tasks with a time (`⏰ HH:MM`) are reminders drawn at that time. Tasks due today with no time sit above the timeline.
   - Week: seven columns on desktop. On the phone it is a strip of days, then a list for each day. Reminders have hollow markers and events have filled ones.
   - Task list with a quick-add box, grouped into Overdue, Today, This week and Someday. It is a side column on desktop and its own section on the phone.
3. **Health trends.** A 2W/1M/3M/1Y range switch. Each metric shows its latest value, its change from the average over the range as a percentage, and a trend line with a dashed average line. Metrics, in order: recovery, HRV, resting HR, sleep score, time asleep, strain, steps, zone 2+ minutes, breathing rate and skin temperature.

## Look

Dark mode only for now. Colours are Apple's dark-mode system colours.

**Neutrals**

| Token | Hex | Use |
|---|---|---|
| background | `#0C0C0E` | page |
| text | `#F5F5F7` | primary text |
| text-2 | `#A1A1A6` | labels |
| text-3 | `#8E8E93` | dimmest text allowed (about 6:1 on the background) |
| line-1, line-2, line-3 | `#1C1C1E`, `#2C2C2E`, `#3A3A3C` | dividers, controls, average lines |
| border-dashed | `#636366` | reminder outlines only, never text |

**Status.** These colours carry meaning and are never used for categories.

| Token | Hex | Use |
|---|---|---|
| good | `#30D158` | recovery 67 to 100 |
| caution | `#FFD60A` | recovery 34 to 66 |
| bad | `#FF453A` | recovery 0 to 33 |
| warn | `#FF9F0A` | overdue tasks |
| now | `#FF453A` | the current-time line (same as Apple Calendar) |

Recovery is the only metric coloured by band. Its number is always shown next to the colour, so the colour is never the only cue.

**Categories.** For calendar events. None of these hues are status colours.

| Token | Hex | Use |
|---|---|---|
| work | `#0A84FF` | work events |
| fitness | `#40C8E0` | gym, runs, physio |
| personal | `#BF5AF2` | social and personal events |
| focus | `#8E8E93` | focus blocks |

Reminders are drawn with a dashed outline and no fill, so they read differently from events without needing a colour.

**Health categories.** Each group of metrics has one line colour, the way Apple Health does it. None of these are status colours.

| Token | Hex | Metrics |
|---|---|---|
| heart | `#FF7EB6` | recovery, HRV, resting HR |
| sleep | `#7D7AFF` | sleep score, time asleep |
| activity | `#64D2FF` | strain, steps, zone 2+ minutes |
| vitals | `#AC8E68` | breathing rate, skin temperature |

The metrics are listed group by group. On desktop the grid fills down each column first, so heart and sleep sit on the left and activity and vitals on the right.

**Type and layout**

- System font (SF Pro on Apple), thin weights (200 to 300) for the large numbers, tabular figures throughout.
- No cards or boxes on the main sections. Hairline dividers and spacing do the grouping. No explanatory labels.

## Files

These are Claude Design components (`.dc.html`). Each renders on the canvas and has the layout and the sample data in one file, so they are a reference for building the real UI rather than code to ship.
