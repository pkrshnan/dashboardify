import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addItems } from "../../src/lists/list-note";
import {
  InvalidTitle,
  ListNotFound,
  ListStore,
  StaleList,
  slugOf,
} from "../../src/lists/list-store";
import { TaskStore } from "../../src/vault/task-store";
import { Vault } from "../../src/vault/vault";

let dir: string;
let vault: Vault;
let lists: ListStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lists-"));
  vault = new Vault(dir, "UTC");
  lists = new ListStore(vault);
  await Bun.write(join(dir, "Lists/Shopping.md"), "## Produce\n- [ ] Bananas\n- [x] Lemons\n");
  await Bun.write(join(dir, "Lists/Gift ideas.md"), "- [ ] Board game\n");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("ListStore", () => {
  test("lists every note in Lists/ by title, with what's left to get", async () => {
    expect(await lists.lists()).toEqual([
      { slug: "gift-ideas", title: "Gift ideas", path: "Lists/Gift ideas.md", openCount: 1 },
      { slug: "shopping", title: "Shopping", path: "Lists/Shopping.md", openCount: 1 },
    ]);
  });

  test("reads one list by slug, in sections", async () => {
    const shopping = await lists.get("shopping");

    expect(shopping?.sections.map((s) => [s.title, s.items.map((i) => i.text)])).toEqual([
      ["Produce", ["Bananas", "Lemons"]],
    ]);
    expect(await lists.get("nope")).toBeNull();
  });

  test("creates a list once; the same title again returns it", async () => {
    const first = await lists.create("Packing, Lisbon");
    const again = await lists.create("packing, lisbon");

    expect(first.created).toBe(true);
    expect(first.list.slug).toBe("packing-lisbon");
    expect(await vault.read("Lists/Packing, Lisbon.md")).toBe("# Packing, Lisbon\n");
    expect(again).toEqual({ list: first.list, created: false });
  });

  test("refuses a title that isn't a safe file name", async () => {
    for (const title of ["", "../escape", "a/b", ".hidden"]) {
      await expect(lists.create(title)).rejects.toBeInstanceOf(InvalidTitle);
    }
  });

  test("an edit with the current etag applies; an old one is refused", async () => {
    const before = await lists.get("shopping");
    const edited = await lists.edit("shopping", before?.etag, (t) => addItems(t, ["Eggs"]).text);

    expect(edited.openCount).toBe(2);
    await expect(
      lists.edit("shopping", before?.etag, (t) => addItems(t, ["Bread"]).text),
    ).rejects.toBeInstanceOf(StaleList);
    await expect(lists.edit("nope", undefined, (t) => t)).rejects.toBeInstanceOf(ListNotFound);
  });

  test("slugs drop case, accents and punctuation", () => {
    expect(slugOf("Café list!")).toBe("cafe-list");
    expect(slugOf("???")).toBe("list");
  });
});

describe("tasks", () => {
  test("list items in Lists/ are not tasks", async () => {
    await Bun.write(join(dir, "Inbox.md"), "- [ ] Call the bank\n");

    const found = await new TaskStore(vault, "Inbox.md").list();

    expect(found.map((t) => t.task.description)).toEqual(["Call the bank"]);
  });
});
