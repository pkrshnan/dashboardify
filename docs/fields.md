# Fields plan

Tasks and habits keep their details as sub-bullets under the line, one `key: value` each,
instead of emoji (tasks) or `·`-separated words (habits). The line holds only the text and the
id, so a note reads like a note.

Status: F1–F4 built. Next, F5.

## Format

```markdown
- [ ] Call the bank <!-- id:k7f3a2 -->
	- due: 2026-11-03 09:00
	- repeat: every week
	- priority: high
- [x] Call Fetch <!-- id:a7efea -->
	- due: 2026-11-04 12:00
	- done: 2026-11-09
- [ ] Return the power adapter

- Gym <!-- id:gym -->
	- schedule: 4 a week
	- auto: lifting ≥ 1
	- colour: BF5AF2
	- since: 2026-11-12
- Read <!-- id:read -->
	- schedule: daily
	- status: paused
```

## Decisions

| Area | Decision |
| --- | --- |
| Fields | A child line `- key: value` directly under the item. A field belongs to the closest line above it with less indent. |
| Keys | Tasks: `due` (date, optional `HH:MM`), `repeat`, `priority` (`highest`, `high`, `medium`, `low`, `lowest`), `done` (date). Habits: `schedule`, `auto`, `colour` (hex, no `#`, so Obsidian doesn't read it as a tag), `since`, `status` (`paused`, `archived`). Keys are read in any case. |
| Owned | The server reads and writes only its keys. Other child lines (notes, nested tasks) stay as they are. A nested `- [ ]` is still its own task. |
| Writing | Owned fields are rewritten in the order above, straight under the line, indented one tab (Obsidian's default). A key with no value is left out. A repeated key: the first wins, the rest are removed on the next write. |
| Id | `<!-- id:… -->` at the end of the line, for tasks and habits. Hidden in Live Preview. A task without one keeps its derived ref. |
| Created date | Dropped. `Task.create_date` is removed from the proto and field 8 reserved; nothing read it. |
| Etag | A task's etag hashes its line and its field lines. `Habits.md` keeps its whole-file etag. |
| Edits | Delete removes the line and its fields. Completing a repeating task puts the next one, with its fields, above the done one. |
| Old format | Read until F6, never written, so any edit converts a line. F5 converts the rest at once. |

## Build plan

| # | PR | Scope | Tests |
| --- | --- | --- | --- |
| F1 | Plan | This doc, CLAUDE.md, roadmap | |
| F2 | Field blocks | `src/vault/fields.ts`: find an item's field lines, read them, rewrite owned keys | Other children kept; nested items own their fields; tabs or spaces; repeated keys; blank line ends a block |
| F3 | Tasks | `tasks.ts` and `task-store.ts` on fields; old lines still read; drop `create_date`; vault-format.md, api.md | Round trip; edit converts an old line; complete with repeat; delete keeps notes; etag covers fields |
| F4 | Habits | `habit-note.ts` on fields; old lines still read; habits.md | Round trip; update keeps notes under a habit; colour without `#` |
| F5 | Convert | `bun run vault:convert`: prints the changes, `--write` applies them. Run once on the server. | Converts an old vault; a second run changes nothing |
| F6 | Clean up | Drop old parsing; habit names may hold `·`; demo data | |
