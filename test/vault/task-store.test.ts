import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../../src/vault/task-store";
import { Vault } from "../../src/vault/vault";

let dir: string;
let tasks: TaskStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tasks-"));
  tasks = new TaskStore(new Vault(dir, "UTC"), "Inbox.md");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const write = (text: string) => Bun.write(join(dir, "Inbox.md"), text);
const read = () => Bun.file(join(dir, "Inbox.md")).text();

describe("TaskStore", () => {
  test("lists every inbox checkbox, and elsewhere only those with a due date or an id", async () => {
    await write("- [ ] Call bank\n");
    await Bun.write(
      join(dir, "Trips/Napa.md"),
      "- [ ] Pack boots\n- [ ] Book winery\n\t- due: 2026-11-20\n- [ ] Moved here <!-- id:m1 -->\n- [x] Done\n\t- done: 2026-11-03\n",
    );
    await Bun.write(join(dir, "Lists/Shopping.md"), "- [ ] Bananas\n\t- due: 2026-11-20\n");

    const found = (await tasks.list()).map((t) => `${t.path}: ${t.task.description}`).sort();

    expect(found).toEqual([
      "Inbox.md: Call bank",
      "Trips/Napa.md: Book winery",
      "Trips/Napa.md: Moved here",
    ]);
  });

  test("adds a task with its fields", async () => {
    const { task } = await tasks.add({ key: "k", description: "Call bank", due: "2026-11-03" });

    expect(await read()).toBe(`- [ ] Call bank <!-- id:${task.ref} -->\n\t- due: 2026-11-03\n`);
  });

  test("an edit rewrites the line and its fields and keeps the rest", async () => {
    await write(
      "# Inbox\n- [ ] Call bank <!-- id:k7f3a2 -->\n\t- note\n\t- due: 2026-11-03\n- [ ] Next\n",
    );

    await tasks.edit("k7f3a2", undefined, (task) => ({ ...task, time: "09:00" }));

    expect(await read()).toBe(
      "# Inbox\n- [ ] Call bank <!-- id:k7f3a2 -->\n\t- due: 2026-11-03 09:00\n\t- note\n- [ ] Next\n",
    );
  });

  test("completing a repeating task puts the next one above, and notes stay with the done one", async () => {
    await write(
      "- [ ] Water plants <!-- id:p1 -->\n\t- due: 2026-11-03\n\t- repeat: every week\n\t- by the window\n",
    );

    const result = await tasks.complete("p1", "2026-11-04");

    expect(result.status).toBe("completed");
    const next = result.status === "completed" ? result.next?.id : undefined;
    expect(await read()).toBe(
      [
        `- [ ] Water plants <!-- id:${next} -->`,
        "\t- due: 2026-11-10",
        "\t- repeat: every week",
        "- [x] Water plants <!-- id:p1 -->",
        "\t- due: 2026-11-03",
        "\t- repeat: every week",
        "\t- done: 2026-11-04",
        "\t- by the window",
        "",
      ].join("\n"),
    );
  });

  test("delete removes the line and its fields but keeps notes and nested tasks", async () => {
    await write(
      "- [ ] Trip <!-- id:t1 -->\n\t- due: 2026-12-01\n\t- [ ] Book flights\n- [ ] Next\n",
    );

    await tasks.edit("t1", undefined, () => null);

    expect(await read()).toBe("\t- [ ] Book flights\n- [ ] Next\n");
  });

  test("a change to a field makes the etag stale", async () => {
    await write("- [ ] A <!-- id:a1 -->\n\t- due: 2026-11-03\n");
    const [found] = await tasks.list();
    const etag = found ? await tasks.etag(found) : "";

    await write("- [ ] A <!-- id:a1 -->\n\t- due: 2026-11-04\n");

    await expect(tasks.edit("a1", etag, (task) => task)).rejects.toThrow("ABORTED");
  });
});
