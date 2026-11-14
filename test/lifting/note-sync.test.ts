import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiftingStore } from "../../src/lifting/lifting-store";
import { ExerciseNotes } from "../../src/lifting/note-sync";
import { Vault } from "../../src/vault/vault";

let dir: string;
let notes: ExerciseNotes;

function read(path: string): Promise<string> {
  return Bun.file(join(dir, path)).text();
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lifting-notes-"));
  const vault = new Vault(dir, "UTC");
  notes = new ExerciseNotes({
    vault,
    lifting: new LiftingStore(vault),
    setsOn: async () => [],
    today: () => "2026-11-14",
  });
  await Bun.write(
    join(dir, "Daily/2026/2026-11-08.md"),
    "## Workouts\n- Chest Press\n    - 80lbs, 3x10\n- Dumbell Shoulder Press\n    - 15lbs, 2x10, 1x8\n",
  );
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("exercise notes", () => {
  test("each exercise gets a note with its history block", async () => {
    const changed = await notes.sync();

    expect(changed.sort()).toEqual(["Lifting/Chest Press.md", "Lifting/Dumbell Shoulder Press.md"]);
    const text = await read("Lifting/Chest Press.md");
    expect(text).toStartWith("<!-- cc:lifting -->\n## History\nNext: 80 lb, 3x11\n");
    expect(text).toContain("| [[2026-11-08]] | 80 lb, 3x10 | 107 |");
  });

  test("your text and frontmatter are kept; a second sync writes nothing", async () => {
    await Bun.write(
      join(dir, "Lifting/Chest Press.md"),
      "---\nreps: 8-10\n---\nSeat on 4.\n\n<!-- cc:lifting -->\nold\n<!-- /cc:lifting -->\n",
    );

    await notes.sync();

    const text = await read("Lifting/Chest Press.md");
    expect(text).toStartWith(
      "---\nreps: 8-10\n---\nSeat on 4.\n\n<!-- cc:lifting -->\n## History\n",
    );
    // At the top of 8–10 the suggestion adds weight.
    expect(text).toContain("Next: 85 lb, 3x8");
    expect(await notes.sync()).toEqual([]);
  });

  test("an alias merges a typo into the note it names", async () => {
    await Bun.write(
      join(dir, "Lifting/Dumbbell Shoulder Press.md"),
      "---\naliases: [Dumbell Shoulder Press]\n---\n",
    );

    const changed = await notes.sync();

    expect(changed).toContain("Lifting/Dumbbell Shoulder Press.md");
    expect(changed).not.toContain("Lifting/Dumbell Shoulder Press.md");
    expect(await read("Lifting/Dumbbell Shoulder Press.md")).toContain("15 lb, 2x10, 1x8");
  });

  test("a note whose frontmatter won't parse is left alone", async () => {
    await Bun.write(join(dir, "Lifting/Chest Press.md"), "---\nreps: [\n---\nmine\n");

    await notes.sync();

    expect(await read("Lifting/Chest Press.md")).toBe("---\nreps: [\n---\nmine\n");
  });
});
