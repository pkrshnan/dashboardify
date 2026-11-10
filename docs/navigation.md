# Navigation plan

How you reach any part of the app and control anything in it, and how a new feature (Lists,
Tasks, Journal) joins: one module file, which the sidebar, tab bar, command bar, shortcuts,
search and Settings all read. Status: planned (N1–N8); N3 and N8 wait for artboards.

## Today

Three hash views checked by hand in `web/app.tsx` (home, `#activity`, `#settings/<id>`), reached
from a Health heading link and a gear. Day/Week, the Activity range and the open event aren't in
the address. `N` is the only shortcut. Each new page edits `app.tsx`; each Settings section edits
`sections.ts` and `settings.tsx`.

## Goals

- Any page in two steps; anything (task, event, workout, day, later list items) in one search.
- Every UI action is also a command, reachable the same way on every page.
- Every page, view and open item has a URL: Back, reload, Shortcuts' "Open URL", notifications
  and Ask's answers can link to it.
- A feature is one `web/modules/<id>.tsx`.

Not goals: user-arranged nav, split views, running commands from Siri (command ids stay stable
for that later), typed sentences through a model (that's Ask, which will appear in the same bar).

## Decisions

| Area | Decision |
| --- | --- |
| Router | Hash paths (`#/`, `#/activity`, `#/settings/calendars`) in a small `web/lib/router.ts`. No server change; the PWA and `#token=` links keep working. |
| Addresses | `#/<page>/<rest>?<state>&<panel>=<name>`: page state (`view=week`) and the open thing (`event=events/abc`) are query parameters, so any page can carry a panel and Back closes it. Old hashes are rewritten with `replaceState`. |
| Modules | `web/modules/<id>.tsx`, listed in order in `web/modules/index.ts`. The shell never names a module. |
| Context | `AppContext` holds the token, time zone, phone flag, `navigate`, `openPanel`, `toast`, `reloadHome` |
| Desktop | A quiet sidebar, groups separated by space, Settings at the bottom; an icon rail under 1200 px |
| Phone | A floating tab bar: Today, Tasks, Search (centre), Lists, More |
| Command bar | `⌘K` / `Ctrl K` or `/`; the Search tab on the phone. Go, find, do and add in one box. |
| Search | Pages, sections and commands searched in the browser with `fuse.js`; things from a new `SearchService`. Ask's index later becomes one more provider. |
| Fall-through | Text matching nothing becomes an Add row through the capture parser |
| Shortcuts | `g` + letter goes to a page; `?` lists them; `N` still focuses capture. Generated from modules. |
| Recency | Per device, in `localStorage` |

## Places

The nav lists only pages that exist.

| Page | Address | Keys | Group | Phone | State |
| --- | --- | --- | --- | --- | --- |
| Today | `#/` (`?view=week`) | `g t` | 1 | Tab | Built |
| Calendar | `#/calendar/<date>` | `g c` | 2 | More | Planned |
| Tasks | `#/tasks` | `g k` | 2 | Tab | Planned |
| Lists | `#/lists/<list>` | `g l` | 2 | Tab | Planned |
| Activity | `#/activity` (`?range=month`) | `g a` | 3 | More | Built |
| Journal | `#/journal/<date>` | `g j` | 4 | More | Planned |
| Settings | `#/settings/<section>` | `g s` | bottom | More | Built |

Panels over any page: `?event=` (`EventPanel`, built), `?workout=` (Activity's detail, built),
`?task=` (`TaskPanel`, N7), `?item=` (with Lists).

## Command bar

Fixed sections, so things are always in the same place: **Top hit**, **Go to** (pages, views,
Settings sections), **Things** (from search, with kind and one detail: "Task · due Fri"), **Do**
(commands), and **Add** last ("Add ‘Lunch with Sam tomorrow 12:30’ · Event · Personal").

Keys: `↑↓` move; `Return` opens or runs; `⌘ Return` the main action without opening (complete,
join); `Tab` the selected thing's actions (Complete, Tomorrow, Next week, Edit, Delete); a page
name then `Tab` searches only that page; `Esc` goes back, then closes. On the phone, long press
shows actions.

A command that takes text takes the rest of the line ("log Felt great"); one that takes a thing
shows only those things. Results show a toast with Undo where the API can undo.

First commands, all on existing RPCs: New event or reminder (`Capture`), Complete task
(`CompleteTask`, Undo `ReopenTask`), Reschedule task (`UpdateTask`), Delete task, Log journal
(`VoiceService.Log`), Check in, Sync calendars (`SyncCalendarAccount`), Day or Week view, Add
device / Connect iCloud / Add calendar link (opens the Settings dialog), Keyboard shortcuts.

## Module contract

```ts
export interface Module {
  id: string;                  // stable: addresses, recency
  title: string;
  icon: IconName;
  nav?: { group: 1 | 2 | 3 | 4 | "bottom"; phone: "tab" | "more"; badge?: (home: HomeView) => Badge };
  key?: string;                // "l" → g l
  routes: Route[];             // { path: "/lists/:list?", view, title }
  commands?: Command[];        // { id: "lists.add", title, arg?: { kind: "text" | "thing" }, run }
  panels?: Record<string, PanelView>;        // thing kind → panel
  actions?: Record<string, ThingAction[]>;   // thing kind → Tab actions
  settings?: { id: string; title: string; view: SettingsView };
}
```

A test checks ids, paths, keys, panel kinds and command ids are unique.

## SearchService

`GET /v1/search?query=&kinds=&pageSize=` → results with `name` (`tasks/abc`, `events/abc`,
`days/2026-11-09`…), `kind`, `title`, `detail`, `time` and a 0–1 `score` comparable across kinds.
`src/search/` has one `SearchProvider` per kind (tasks from `TaskStore`, events from the cache a
year either way, workouts from `health-derived`, days by journal text). The web app asks after
120 ms and merges results under the static ones, so a late answer never moves the selection.

## Look

Home screen tokens ([design/README.md](design/README.md#look)).

- **Sidebar:** 220 px on the page background; 36 px rows, 17 px icon and name in text-2; the
  current page on `fill` with 8 px corners. Badges in text-3, warn when overdue. The 1440 px
  maximum includes it, so artboards must recheck the Day timeline and task column.
- **Tab bar:** a capsule 16 px from the edges above the home indicator, blurred `fill`; 11 px
  names; Search a round centre button. Pages pad their bottom to clear it; "‹ Home" links go.
- **Command bar:** 640 px, 15% from the top, `fill` with a `line-3` hairline and 12 px corners
  over a dimmed page; 17 px input, 40 px rows (44 on the phone, a full-height sheet), selected
  row `line-2`, section names and the key footer in text-3.
- **Toast:** bottom centre, above the tab bar, with Undo, 5 seconds.

## Build plan

| # | PR | Needs | Scope | Tests |
| --- | --- | --- | --- | --- |
| N1 | Router and addresses | | `web/lib/router.ts`, `useRoute`, `navigate`; old hashes redirect; Day/Week and Activity range in the query. No visual change. | Address ↔ route table, old hashes, unknown → Today, `#token=` untouched |
| N2 | Modules and context | N1 | `web/modules/{types,index,today,activity,settings}.tsx`, `AppContext`; Settings sections from modules. No visual change. | Registry uniqueness; Settings still lists its sections |
| N3 | Command bar: go to | N2, artboards | `command-bar.tsx`, `web/lib/command-search.ts` (fuse.js, recency), `⌘K` and `/`; a phone search button until N8 | Ranking table; keys component test |
| N4 | Commands, toast, shortcuts | N3 | Command args, the first commands, the Add row, `toast.tsx`, `g` keys and `?` | Arg mode; Add row matches capture; Undo calls the reverse; keys skip text fields |
| N5 | SearchService | | `search.proto`, `src/search/` providers, `api/search.ts`, REST binding, api.md | Each kind, `kinds`, page cap, cross-kind order, empty vault, no calendar |
| N6 | Things and panels by address | N4, N5 | Results in the bar; `?event=`, `?workout=` over any page; Tab actions, `⌘ Return` | Panels follow the address and Back; late results don't move the selection |
| N7 | Task panel | N6, artboards | `task-panel.tsx`: description, due, priority, recurrence, Today/Tomorrow/Next week, Delete; ring completes and text opens the panel. Starts reminder editing. | Form helpers; stale etag refused |
| N8 | Sidebar and tab bar | N2, artboards, 4+ pages | `sidebar.tsx`, `tab-bar.tsx`, More, badges; drop "‹ Home" | Current page, rail, More |

N5 can be reviewed beside N1–N4. N8 waits for Tasks or Lists so the sidebar has something to hold.

## Adding a module

After N2: a plan in `docs/<feature>.md` → proto → store in `src/<feature>/` → service, registered
in `routes/v1.ts` and `rest-bindings.ts` → a search provider in `src/search/` → calls in
`web/api.ts` → `web/modules/<feature>.tsx` (route, nav, key, commands, panels, actions, Settings
section) → tests, `docs/api.md`, `docs/vault-format.md`, the roadmap.

## Open questions

- [ ] Phone tabs: Today, Tasks, Search, Lists, More?
- [ ] Keep the capture box on Today? Planned yes: most used, and it draws the pending event.
- [ ] N7 drops the whole-row tick (ring completes, text opens). Acceptable?
- [ ] Recency per device, or synced through `settings.db`?
