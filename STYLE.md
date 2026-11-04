# TypeScript style

Biome is the repository's formatter, linter, and import organizer. Its checked-in configuration
is authoritative: two-space indentation, double quotes, semicolons, and a 100-column line width.
Run `bun run format` before committing and `bun run check` to verify changes.
CI runs the same checks. Generated protobuf code is excluded; regenerate it instead of editing it.

## Spacing and readable code

- Keep one blank line after the imports and between top-level declarations, class members,
  and tests. Keep documentation comments attached to the declaration they describe.
- Within a function, separate setup, the main operation, and the result when those form distinct
  steps. Avoid a blank line after every statement.
- Use descriptive names and explicit input types. Keep route wiring, protobuf conversion,
  validation, and storage operations easy to distinguish.
- Keep helpers close to the code that uses them. Share helpers when they express a common rule,
  rather than extracting each expression to satisfy a size limit.
- Follow the existing complexity limits. Refactor code instead of suppressing them.

Biome handles syntax formatting and preserves meaningful blank lines; it does not enforce all
of these paragraph-spacing conventions. Review spacing alongside the code's structure.

## Tests

Mirror the source layout: `src/server/api/tasks.ts` is covered by
`test/server/api/tasks.test.ts`. Group cases with `describe` and name each test for observable
behavior. Keep shared setup in `test/server/api/helpers.ts` so every test gets an isolated vault.

Test each executable module at its public boundary. Service tests may use the real authenticated
HTTP app; shared parsing and validation helpers have direct unit tests. Type-only definitions
and declarative binding tables do not need tests that merely repeat their contents; transport
and service tests cover the bindings. Keep UI adapter tests under `test/web`.

Separate setup, action, and assertions with blank lines. Cover failure cases and state changes,
including persistence, retries, update masks, and concurrency where applicable.
