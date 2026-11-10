# Code style

Biome enforces most of this (`bun run lint`, and CI fails on any warning). Its checked-in
configuration (`biome.json`) is authoritative: two-space indentation, double quotes, semicolons
and a 100-column line width. Run `bun run format` before committing and `bun run check` to verify.
Generated protobuf code in `src/gen/` is excluded; regenerate it instead of editing it.

## Enforced by the linter

- **Small functions.** Cognitive complexity of at most 10, and at most 40 lines per function
  (tests are exempt from the line limit). When a function grows past that, split it into named
  steps. Refactor rather than suppress.
- **Braces on every `if`, `for` and `while`**, even one-liners.
- **No nested ternaries.** Use an `if` or a small helper.
- **No `!` non-null assertions.** Handle the missing case.
- **No reassigning parameters.** Use a new, named variable.
- **Explicit length checks:** `items.length > 0`, not `items.length`.
- **Type-only imports** use `import type`.
- **camelCase** for code. API fields and env vars keep their wire names (`received_at`,
  `VAULT_PATH`).
- **kebab-case file names.**

## Conventions

- **One area per file.** Each v1 service has its own file in `src/server/api/`, its proto in
  `proto/dashboardify/v1/`, and its REST paths in `src/server/api/rest-bindings.ts`.
  `src/server/routes/v1.ts` and `app.ts` only wire them up.
- **Validate, then act.** Requests are checked with Protovalidate before a service runs; a service
  then turns the request into a typed value and calls the store.
- **Name the intent.** Prefer `isEmptySection` over a bare `insertAt === idx + 1`, and
  `byDueThenTitle` over an inline sort callback.
- **Comment the why.** Each file starts with a short note on what it is for. Comments explain
  decisions and invariants, not what the next line does.
- **Keep helpers close** to the code that uses them. Share a helper when it expresses a common
  rule, not to satisfy a size limit.
- **Web logic in `web/lib/`.** Components in `web/components/` and `web/settings/` render; the
  rules they follow (layout, parsing, form state) are pure functions in `web/lib/` or a
  `*-helpers.ts` file, so they can be tested without a DOM.

## Spacing

- One blank line after the imports and between top-level declarations, class members and tests.
  Documentation comments stay attached to the declaration they describe.
- Within a function, separate setup, the main operation and the result when those are distinct
  steps. Avoid a blank line after every statement.

Biome keeps meaningful blank lines but does not enforce these; review spacing with the structure.

## Tests

- Mirror the source layout: `src/server/api/tasks.ts` is covered by
  `test/server/api/tasks.test.ts`. Group cases with `describe` and name each test for observable
  behaviour.
- Test each module at its public boundary. Service tests use the real authenticated HTTP app
  through `useApi()` in `test/server/api/helpers.ts`, which gives every test an isolated vault and
  `DATA_PATH`. Pure helpers have direct unit tests.
- **No network.** CalDAV, ICS feeds, Photon and model calls go through a `fetch` or interface that
  tests replace: `test/calendar/fake-caldav.ts`, `test/places/fake-photon.ts`.
- Web: pure helpers in `test/web/*.test.ts`; component tests in `test/web/*.test.tsx` use
  happy-dom through `test/web/dom.ts`.
- Type-only definitions and declarative binding tables don't need tests that repeat them.
- Separate setup, action and assertions with blank lines. Cover failure cases and state changes,
  including persistence, retries, update masks and concurrency where they apply.
