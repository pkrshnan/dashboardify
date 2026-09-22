# Dashboardify interface direction

## Chosen direction: Quiet Ledger

A restrained personal ledger: warm neutral canvas, crisp typography, thin dividers, and one saturated blue reserved for action and focus. Information density is closer to a well-made calendar or notebook than a consumer analytics dashboard.

The design must not use gradients, glass panels, floating-card grids, oversized metric numerals, generic illustrations, or decorative AI sparkle motifs. Charts appear only when they reveal a trend better than text.

## Explored directions

### A. Quiet Ledger — selected

- **Character:** calm, editorial, durable.
- **Structure:** narrow navigation rail, chronological center column, contextual right rail on wide screens.
- **Strength:** supports mixed records without making the home screen look like a collection of unrelated widgets.
- **Risk:** can feel sparse if hierarchy depends only on whitespace; typography and dividers must carry structure.

### B. Dense Operator

- **Character:** compact, keyboard-first, near-monochrome.
- **Structure:** command palette plus high-density tables and split panes.
- **Strength:** fastest for heavy desktop use and triage.
- **Risk:** weaker on phones and less inviting for daily reflection.

### C. Weekly Canvas

- **Character:** visual planner with a week grid as the home surface.
- **Structure:** calendar occupies most of the screen; tasks and habits sit beside dates.
- **Strength:** excellent temporal orientation.
- **Risk:** notes, people, and undated facts become secondary.

**Decision:** use Quiet Ledger as the system, borrow Dense Operator’s keyboard behaviors, and make Weekly Canvas the dedicated Calendar view rather than the application shell.

## Visual language

### Typography

Use **Atkinson Hyperlegible Next** for all interface and reading text. The variable family supplies intermediate weights that avoid the overly heavy appearance of the original prototype’s 700 weight. Use **JetBrains Mono** only for times, dates, keyboard shortcuts, compact labels, identifiers, and measurements.

```css
--font-sans: "Atkinson Hyperlegible Next", "Segoe UI", sans-serif;
--font-mono: "JetBrains Mono", "Cascadia Mono", monospace;
```

Body copy uses 400, secondary emphasis uses 500, and titles or primary labels use 600. The interface does not use 700. Production builds should self-host the smallest required WOFF2 variable-font subsets. The standalone prototype loads both families from Google Fonts so it can be opened without a build step.

### Color tokens

The interface uses one neutral scale and a forest green accent. Light and dark values express the same semantic roles and follow the operating-system preference through `prefers-color-scheme`. This is not a mechanical inversion: the dark surfaces retain visible depth and the green becomes lighter to preserve contrast.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `canvas` | `#F2F5F1` | `#101511` | grouped background and contextual rails |
| `surface` | `#FCFDFB` | `#181E1A` | primary content and elevated groups |
| `ink` | `#1D231F` | `#EDF3EE` | primary text and strong controls |
| `muted` | `#626B64` | `#A4AEA6` | metadata and secondary text |
| `line` | `#D7DED8` | `#353D37` | boundaries and progress tracks |
| `accent` | `#246B4A` | `#78C99C` | action, focus, current state, and confirmation |
| `accent-wash` | `#E5F1E9` | `#20392B` | selected or informative background |

The forest green is the only chromatic interface accent. Record types still use icon plus text rather than separate colors. Completion uses a check, label, and text treatment in addition to color. Destructive red is introduced only where a destructive state exists.

### Shape, borders, and depth

- Base spacing unit: 4 px; common gaps: 8, 12, 16, 24, 32.
- Desktop controls use 8–10 px radii. Mobile grouped lists use 16 px and bottom sheets use 20 px.
- Dividers, alignment, and surface color create hierarchy. Shadows are reserved for sheets, menus, and drag state.
- Primary desktop content max width: 720 px. Full calendar views may use the available width.
- Motion: 120–180 ms for local transitions; disabled under `prefers-reduced-motion`.

### Iconography

One consistent 18/20 px outline set with 1.75 px strokes. Labels remain visible for navigation on desktop and are available to assistive technology everywhere. No icon is used decoratively when text suffices.

## Application frame

### Live prototype

Open [`design/dashboard.html`](../../design/dashboard.html) directly in a browser. It is a responsive implementation of Today and Quick Capture, not a wireframe. It includes:

Static exports are available for [desktop light](../../design/dashboard-desktop.png), [desktop dark](../../design/dashboard-desktop-dark.png), [mobile light](../../design/dashboard-mobile.png), and [mobile dark](../../design/dashboard-mobile-dark.png).

- Atkinson Hyperlegible Next with a 600 maximum interface weight and JetBrains Mono metadata;
- an automatic light/dark neutral-and-forest palette;
- desktop navigation, chronological Today content, and contextual right rail;
- a simplified 390 px mobile layout with four destination tabs and inset grouped lists;
- an inline Quick Capture composer with live intent highlighting and `C` or `⌘K`/`Ctrl+K` focus shortcuts;
- interactive task completion and confirmation messages;
- visible focus states, reduced-motion handling, and no horizontal overflow at the target widths.

The production interface lives in [`web/`](../../web/). It carries this hierarchy into React and TypeScript, uses the shadcn/ui Nova source components with Lucide icons, and self-hosts Geist from the bundled frontend assets. Project CSS owns the forest palette, density, timeline composition, and responsive frame; shadcn supplies accessible primitives rather than a second visual language.

### Desktop, 1180 px and wider

The desktop prototype uses a 208 px navigation rail, fluid center column, and 264 px contextual rail. The center working area uses the primary surface; both rails use the canvas role. The right rail disappears below 1180 px, leaving the primary workflow uninterrupted. Both appearances retain the same hierarchy and change automatically with the system setting.

### Mobile, 390 px reference

The mobile implementation removes the repeated brand header and exposes the page title immediately. Schedule and task content use familiar inset grouped lists on the canvas. The persistent tab bar contains four top-level destinations—Today, Inbox, Calendar, and More—while the inline composer remains visible near the page title, preserves a 44 px input target, and respects safe-area spacing.

This borrows principles rather than ornament from [Apple’s tab-bar guidance](https://developer.apple.com/design/human-interface-guidelines/tab-bars) and [Juxtopposed’s user-centered redesign approach](https://www.youtube.com/watch?v=OUM6XmhViN4): preserve familiar structure, use one consistent icon/component language, prioritize the user’s primary task, and remove controls that compete without adding hierarchy. It deliberately avoids copying branded iOS materials or decorative “Liquid Glass.”

## Core surfaces

### 1. Quick Capture

The composer is always expanded in the Today surface. It accepts text immediately; `C` or `⌘K`/`Ctrl+K` focuses it from anywhere without opening a dialog.

Behavior:

- The raw capture is committed before deterministic classification.
- Intent, time, date, and place phrases are highlighted inline while typing; the app never rewrites the text.
- A compact line below the field states the inferred type and normalized time/place, making bare-time assumptions visible before submission.
- Reminder language files a reminder; a recognized date without a time is shown and stored as “all day.” Scheduled event language files an event, and unmatched text files a note.
- Success appears beside the composer and the record enters “Recently captured.” Errors retain the complete input for retry.
- The UI does not use a chat transcript, modal confirmation flow, or model-confidence percentage.

### 2. Today

A chronological stream, not a tile dashboard. Events, reminders, and scheduled activities align to a common time gutter. Undated tasks and habits follow in compact sections. Completed records collapse behind “Completed · 4”.

Primary interactions:

- Checkbox completes a task/activity; the row remains briefly with Undo.
- Clicking time opens a small editor on desktop and a bottom sheet on mobile.
- Left/right bracket shortcuts change date; `T` returns to today.
- The “now” marker appears only on the actual current day.
- Empty state: date, one sentence (“Nothing scheduled”), and the capture control. No illustration.

### 3. Inbox

A two-pane triage surface on desktop and sequential cards on mobile.

The Inbox should reuse the prototype’s typography, dividers, restrained labels, and capture proposal form. On desktop it becomes a two-pane list and detail surface; on mobile it becomes a sequential triage view. It must be implemented as the next dedicated prototype rather than represented by another text wireframe.

Keyboard: `J/K` moves, number keys select type, `E` edits, `D` defers, `Enter` files. Every shortcut has a discoverable menu equivalent.

### 4. Calendar

- Desktop defaults to week; narrow screens default to three-day or agenda.
- Native events use solid ink text and a light accent edge. External read-only events use a link glyph and provider label.
- Overlaps form columns; events never visually cover one another.
- Drag and resize are enhancements. Every operation also has an accessible form.
- All-day items occupy a separate bounded row.
- Calendar density is controlled through a visible/compact preference, not browser zoom tricks.

### 5. Notes and search

Notes list uses title, two-line excerpt, modified date, and restrained tags. The editor is a plain writing surface with preview available, not a permanent split screen.

Search opens as an overlay on desktop and a full page on mobile. Results group only when it clarifies meaning; default order balances exact match and recency. Query terms are highlighted accessibly. Filters use plain labels: Type, Date, Person, Place.

### 6. People, places, and facts

Entity pages resemble a dossier, not a CRM:

- name and aliases;
- pinned facts;
- recent timeline of related facts, notes, tasks, and events;
- “Add fact” and “Capture about this person/place” actions.

Superseded facts remain available under History with dates and provenance.

### 7. Habits and activity

Today shows due habits as quiet checklist rows. The Habits page emphasizes a week matrix and meaningful totals rather than streak fire icons.

The Today prototype shows habit rows, weekly progress, completion treatment, and the absence of gamified streak decoration. A dedicated week matrix should be implemented as an HTML prototype when the Habits phase starts, using text alternatives for every state and visibly distinguishing missed from not scheduled.


## Navigation and information architecture

Primary destinations: Today, Inbox, Calendar, Notes, People, Habits. Global Search and Capture are actions, not destinations. Settings contains Profile & timezone, Appearance, Notifications, Integrations, Data & export, Security, and System status.

On mobile, Today, Inbox, Capture, and Calendar are fixed. “More” opens Notes, People, Habits, Search, and Settings. Badge counts appear only for items needing action.

URLs remain durable and shareable within the authenticated account:

- `/today/2026-09-20`
- `/inbox`
- `/calendar/week/2026-09-20`
- `/notes/:id`
- `/people/:id`
- `/habits`
- `/search?q=...`

## Component inventory

Use shadcn/ui primitives as the accessibility baseline, then build only these feature compositions:

- Application shell and responsive navigation
- Button, icon button, link, menu, tooltip
- Text field, textarea, select/combobox, checkbox, date/time input
- Dialog and mobile bottom sheet using one focus-management contract
- Toast/status region with Undo action
- Record icon/label and metadata row
- Timeline row and time gutter
- Empty, loading, pending, and recoverable error states
- Capture composer and parsed-proposal fields

Use the Card primitive only for genuinely bounded grouped content such as the capture composer or recent-capture group. Timeline rows, list rows, and form sections remain semantic compositions rather than every surface becoming a card.

## Interaction states

Every mutation follows the same visible sequence:

1. Immediate local pending state.
2. Server-confirmed state, usually silent except for consequential actions.
3. Recoverable inline error that preserves input and offers Retry.
4. Undo for reversible destructive or status-changing actions.

Skeletons are allowed only where layout is known. Initial server-rendered pages should usually show content directly, avoiding decorative loading shimmer.

## Content style

- Sentence case everywhere.
- Labels describe the object: “Reminder time,” not “When should we remind you?”
- Buttons describe the action: “File fact,” “Complete task,” “Export data.”
- Avoid “Awesome,” “You’re crushing it,” and anthropomorphic model copy.
- Dates use human text where close (“Tomorrow, 7:00 PM”) and exact text in detail views (“22 Sep 2026, 7:00 PM EDT”).
- Errors say what remains safe: “Couldn’t file this. Your capture is saved in Inbox.”

## Accessibility acceptance

- A visible skip link reaches main content.
- Keyboard focus order follows visual order and returns to the invoker after dialogs.
- Capture, triage, complete, defer, calendar edit, search, and export work without pointer input.
- Dynamic save/error messages use an appropriately restrained live region.
- Calendar slots and habit matrices expose equivalent lists for assistive technology.
- At 200% zoom and 320 CSS px width, no core workflow requires horizontal page scrolling.
- Color tokens pass WCAG 2.2 AA in the combinations in which they are used.

## Design implementation sequence

1. Treat the verified light and dark HTML prototype as the visual baseline for Today and Quick Capture.
2. Keep the production React shell, shadcn/ui primitives, Lucide icons, adaptive tokens, and self-hosted Geist assets as one component language.
3. Add Inbox and Calendar by composing the existing primitives; do not introduce a second design system.
4. Exercise keyboard use, screen-reader labels, 200% zoom, 320 px width, reduced motion, and both system appearances for each new surface.
5. Build dedicated HTML prototypes only when a new surface needs interaction exploration before production composition.
6. Add charts only for a specific habit/fitness question and verify that a table cannot answer it more clearly.
