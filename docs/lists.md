# Lists plan

Checklists you keep and tick off: shopping first, then packing, gift ideas, films. One note per
list in the vault, a Lists page on desktop and phone, and Siri to add from anywhere. Design: the
Lists boards on https://claude.ai/artifact/XuhyWehLi6CPS3yFr4paUU. Status: built (LS1–LS5). Siri: [shortcuts/add-to-list.md](../shortcuts/add-to-list.md).

## Goals

- Add to a list in a second, from the page, the phone or Siri ("add oat milk to shopping").
- Use it in the shop: big rows, one tap to tick, ticked items out of the way.
- A list is a plain note you can also edit in Obsidian.
- Something you've bought before goes back to where it was, not to the bottom as a new line.

Not goals: shared lists, quantities as numbers, prices, reminders on items (that's Tasks).

## Decisions

| Area | Decision |
| --- | --- |
| Storage | One note per list: `Lists/<Title>.md`. `##` headings are sections; items are `- [ ]` / `- [x]` lines. The folder is `Lists` in the vault root. |
| Not tasks | `TaskStore` skips `Lists/`, so list items never show up in Tasks, Today or Siri's due list |
| Item ids | No markers in the note. An item is named by a hash of its section, text and which occurrence it is (`lists/shopping/items/k3f9a2`). Editing its text gives it a new name, which the response returns. |
| Detail | A trailing `(…)` is the item's note, shown on the right: `- [ ] Spinach (2 bags)` |
| Ticking | `[x]` in place; the page shows ticked items under "Done". "Clear done items" removes the `[x]` lines. |
| Adding | New items go at the end of the block before the first section, or of the section picked beside the add box. A new section is a `## Heading` at the end of the note, made with its first item. An item that matches a ticked one (same text, ignoring case) is unticked where it is instead, so bananas go back to Produce; picking a section moves it there. Commas add several. |
| Sections | Matched ignoring case. Moving an item takes its line and indented lines to the end of the other section and gives it a new name. Renaming, reordering or deleting a section is done in Obsidian. |
| Concurrency | The list's etag is a hash of the note; writes send it and a stale one is `409`, as tasks do. One writer per file through `Vault.update`. |
| Order | Items keep the note's order; the page doesn't reorder within a section. |
| Lists | `ListLists` reads `Lists/*.md` in title order. A new list is a new note; deleting or renaming one is done in Obsidian. |

## Vault format

```markdown
# Shopping

- [ ] Coffee beans

## Produce
- [ ] Bananas
- [ ] Spinach (2 bags)
- [x] Lemons

## Dairy
- [ ] Oat milk (2)
```

The title is the file name; a `# Heading` is optional and left alone. Lines that aren't items or
`##` headings (notes, blank lines, deeper headings) are kept exactly. Indented sub-items are read
as part of the line above and not shown.

## API

`proto/dashboardify/v1/list.proto`, `ListService`:

| Method | Path | Does |
| --- | --- | --- |
| GET | `/v1/lists` | Each list's `name`, `title` and `openCount` |
| POST | `/v1/lists` | Create `Lists/<title>.md`; one already there is returned, so a retry is safe |
| GET | `/v1/lists/{list}` | Its sections, each with items (`name`, `text`, `note`, `done`, `section`), and `etag` |
| POST | `/v1/lists/{list}/items` | Add items (`texts`, commas split) into `section`, unticking matches |
| PATCH | `/v1/lists/{list}/items/{item}` | `text`, `note`, `done` or `section` (send `updateMask`) |
| DELETE | `/v1/lists/{list}/items/{item}` | Remove the line |
| POST | `/v1/lists/{list}:clearDone` | Remove every `[x]` line |
| RPC | `VoiceService/AddToList` | `list`, `text`; finds the list by its spoken name; commas and "and" separate items, unless the phrase is already on the list ("mac and cheese"); speaks back what it added |

`{list}` is the file name's slug (`Shopping.md` → `shopping`).

## Web

A `lists` module at `#/lists/:list?`, sidebar group 2, a phone tab, icon `lists`.

- Desktop: the lists in a column beside the open list, and "+ New list". The add box at the top,
  with a section menu beside it ("No section", the headings, "New section…"); sections with their
  items, each with a drag handle (shown on hover; always on the phone). Drag it onto another
  section, or focus it and press ↑ or ↓; while dragging, empty sections and "No section" show as
  drop zones. "Done · 3" with "Clear done items"; the note's path.
- Phone: `#/lists` shows the lists; `#/lists/shopping` the list, with 52 px rows and "Done" at
  the bottom.
- The wording fits any list: "7 left", "All done", "Done", not shopping's "to get" and "got".
- A tick shows at once and is sent in order, as on Today.

## Build plan

| # | PR | Scope | Tests |
| --- | --- | --- | --- |
| LS1 | List notes | `src/lists/` parse, serialize, item names, add with unticking, clear; `ListStore` over the vault; `TaskStore` skips `Lists/`; vault-format.md | Round trip keeps every other line; names stable across unrelated edits; add unticks a match; commas; tasks in `Lists/` aren't tasks |
| LS2 | ListService | `list.proto`, `src/server/api/lists.ts`, REST bindings, api.md | Each method; stale etag `409`; unknown list `404`; `requestId` retry |
| LS3 | Lists page | `web/modules/lists.tsx`, `web/api.ts`, styles; the sidebar and tab bar gain Lists; demo lists | Component tests for add, tick, Got, clear; the module in the nav |
| LS4 | Siri | `VoiceService.AddToList`, `shortcuts/add-to-list.md` | Fuzzy list name, commas, the spoken sentence |
| LS5 | Sections | Add into a section (new ones get a heading), move an item with `updateMask=section`; the section menu and the move handle | Insert at a section's end, new heading, move with indented lines, ticked match moved; API and page tests |

## Open questions

- [ ] Should ticked items clear themselves after a day, instead of "Clear got items"?
- [ ] Learn a section for a brand-new item ("yogurt" → Dairy) from other lists' history?
