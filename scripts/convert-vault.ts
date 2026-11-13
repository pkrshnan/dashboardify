// bun run vault:convert [--write]: moves tasks and habits to sub-bullet fields (docs/fields.md).
// Prints each change; only --write saves them. Reads VAULT_PATH, like the server. Stop the
// server first, or run it while nothing else edits the vault.

import { resolve } from "node:path";
import { HABITS_PATH } from "../src/habits/habit-store";
import { LISTS_FOLDER } from "../src/lists/list-store";
import { type Conversion, convertHabits, convertTasks } from "../src/vault/convert";
import { Vault } from "../src/vault/vault";

const root = resolve(process.env.VAULT_PATH ?? "vault");
const write = process.argv.includes("--write");
// Days don't matter here: nothing is dated by the clock.
const vault = new Vault(root, "UTC");

let items = 0;
for await (const path of new Bun.Glob("**/*.md").scan({ cwd: root })) {
  if (path.startsWith(`${LISTS_FOLDER}/`)) {
    continue;
  }
  const convert = (text: string): Conversion => {
    const tasks = convertTasks(text);
    if (path !== HABITS_PATH) {
      return tasks;
    }
    const habits = convertHabits(tasks.text);
    return { text: habits.text, changes: [...tasks.changes, ...habits.changes] };
  };
  const { changes } = convert((await vault.read(path)) ?? "");
  if (changes.length === 0) {
    continue;
  }
  items += changes.length;
  console.log(`\n${path}`);
  for (const { before, after } of changes) {
    console.log([...before.map((l) => `- ${l}`), ...after.map((l) => `+ ${l}`)].join("\n"));
  }
  if (write) {
    // Converted again inside the write, so an edit since the read isn't lost.
    await vault.update(path, (text) => {
      const again = convert(text ?? "");
      return again.changes.length > 0 ? again.text : null;
    });
  }
}
console.log(
  `\n${items} item${items === 1 ? "" : "s"} ${write ? "converted" : "to convert; run with --write to save"}.`,
);
