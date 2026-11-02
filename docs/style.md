# Code style

Biome enforces most of this (`bun run lint`, and CI fails on any warning). The rest is convention.

## Enforced by the linter

- **Small functions.** Cognitive complexity of at most 10, and at most 40 lines per function
  (tests are exempt from the line limit). When a function grows past that, split it into named
  steps.
- **Braces on every `if`, `for` and `while`**, even one-liners.
- **No nested ternaries.** Use an `if` or a small helper.
- **No `!` non-null assertions.** Handle the missing case.
- **No reassigning parameters.** Use a new, named variable.
- **Explicit length checks:** `items.length > 0`, not `items.length`.
- **Type-only imports** use `import type`.
- **camelCase** for code. API fields and env vars keep their wire names (`received_at`,
  `VAULT_PATH`).
- **kebab-case file names.**
- Lines are at most 100 characters.

## Conventions

- **One area per file.** Each HTTP area has its own file in `src/server/routes/`, and
  `app.ts` only wires the routes up.
- **Validate, then act.** A route first turns the body into a typed value with a `parse…`
  function that returns `Parsed<T>` (a value or an error), and then calls the vault. See
  `src/server/validate.ts`.
- **Name the intent.** Prefer `isEmptySection` over a bare `insertAt === idx + 1`, and
  `byDueThenTitle` over an inline sort callback.
- **Comment the why.** Each file starts with a short note on what it is for. Comments explain
  decisions and invariants, not what the next line does.
