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
3. **Health trends.** A 2W/1M/3M/1Y range switch. Each metric shows its latest value, its change from the average over the range as a percentage, and a trend line with a dashed average line. Metrics: recovery, sleep score, time asleep, strain, HRV, resting HR, steps, zone 2+ minutes, breathing rate and skin temperature.

## Look

- Dark: background `#0C0C0E`, text `#F5F5F7`, secondary text `#A1A1A6` and `#8E8E93`, dividers `#1C1C1E` to `#2C2C2E`.
- System font (SF Pro on Apple), thin weights (200 to 300) for the large numbers, tabular figures throughout.
- Accent colours are used only for meaning: green for recovery, orange for overdue and strain, Apple blue for events, purple for sleep and personal events, red for now.
- No cards or boxes on the main sections. Hairline dividers and spacing do the grouping. No explanatory labels.

## Files

These are Claude Design components (`.dc.html`). Each renders on the canvas and has the layout and the sample data in one file, so they are a reference for building the real UI rather than code to ship.
