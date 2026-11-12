import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { useApi } from "./helpers";

const SHOPPING = "## Produce\n- [ ] Bananas\n- [x] Lemons\n\n## Dairy\n- [ ] Oat milk (2)\n";

type Item = { name: string; text: string; note?: string; done?: boolean; section?: string };
type Section = { title?: string; items: Item[] };

describe("ListService", () => {
  const api = useApi();

  beforeEach(async () => {
    await Bun.write(join(api.dir, "vault/Lists/Shopping.md"), SHOPPING);
  });

  const shopping = async () => (await api.call("/v1/lists/shopping")).body;
  const item = async (text: string): Promise<Item> => {
    const sections: Section[] = (await shopping()).sections;
    const found = sections.flatMap((s) => s.items).find((i) => i.text === text);
    if (!found) {
      throw new Error(`no ${text}`);
    }
    return found;
  };

  test("lists the lists, and reads one in sections", async () => {
    const lists = await api.call("/v1/lists");
    const list = await shopping();

    expect(lists.body.lists).toEqual([
      { name: "lists/shopping", title: "Shopping", path: "Lists/Shopping.md", openCount: 2 },
    ]);
    expect(list.sections.map((s: Section) => [s.title, s.items.map((i) => i.text)])).toEqual([
      ["Produce", ["Bananas", "Lemons"]],
      ["Dairy", ["Oat milk"]],
    ]);
    expect(list.etag).toBeTruthy();
    expect((await api.call("/v1/lists/nope")).status).toBe(404);
  });

  test("creates a list as a note", async () => {
    const { status, body } = await api.call("/v1/lists", "POST", { title: "Gift ideas" });

    expect(status).toBe(200);
    expect(body.name).toBe("lists/gift-ideas");
    expect(await api.vaultFile("Lists/Gift ideas.md")).toBe("# Gift ideas\n");
    expect((await api.call("/v1/lists", "POST", { title: "../out" })).status).toBe(400);
  });

  test("adds items, splitting commas and unticking ones already got", async () => {
    const { body } = await api.call("/v1/lists/shopping/items", "POST", {
      texts: ["eggs, lemons", "Spinach (2 bags)"],
    });

    expect(body.items.map((i: Item) => [i.text, i.done ?? false, i.section ?? ""])).toEqual([
      ["eggs", false, ""],
      ["Lemons", false, "Produce"],
      ["Spinach", false, ""],
    ]);
    expect(await api.vaultFile("Lists/Shopping.md")).toBe(
      "- [ ] eggs\n- [ ] Spinach (2 bags)\n\n## Produce\n- [ ] Bananas\n- [ ] Lemons\n\n## Dairy\n- [ ] Oat milk (2)\n",
    );
  });

  test("ticks and unticks an item through the update mask", async () => {
    const bananas = await item("Bananas");
    const path = `/v1/${bananas.name}`;

    const ticked = await api.call(`${path}?updateMask=done`, "PATCH", { done: true });
    const unticked = await api.call(`${path}?updateMask=done`, "PATCH", { done: false });

    expect(ticked.body.done).toBe(true);
    expect(unticked.body.done ?? false).toBe(false);
    expect(await api.vaultFile("Lists/Shopping.md")).toBe(SHOPPING);
  });

  test("renaming gives the item a new name; the old one is gone", async () => {
    const bananas = await item("Bananas");

    const { body } = await api.call(`/v1/${bananas.name}?updateMask=text,note`, "PATCH", {
      text: "Plantains",
      note: "ripe",
    });

    expect(body.text).toBe("Plantains");
    expect(body.note).toBe("ripe");
    expect(body.name).not.toBe(bananas.name);
    expect((await api.call(`/v1/${bananas.name}?updateMask=done`, "PATCH", {})).status).toBe(404);
  });

  test("adds to a section, making its heading when it's new", async () => {
    const into = (section: string, texts: string[]) =>
      api.call("/v1/lists/shopping/items", "POST", { texts, section });

    const dairy = await into("dairy", ["Butter"]);
    await into("Household", ["Foil"]);

    expect(dairy.body.items[0].section).toBe("Dairy");
    expect(await api.vaultFile("Lists/Shopping.md")).toBe(
      `${SHOPPING.replace("(2)\n", "(2)\n- [ ] Butter\n")}\n## Household\n- [ ] Foil\n`,
    );
    expect((await into("Two\nlines", ["Tea"])).status).toBe(400);
  });

  test("moves an item through the update mask; an empty section is the top", async () => {
    const bananas = await item("Bananas");

    const moved = await api.call(`/v1/${bananas.name}?updateMask=section`, "PATCH", {
      section: "Dairy",
    });
    const back = await api.call(`/v1/${moved.body.name}?updateMask=section`, "PATCH", {});

    expect(moved.body.section).toBe("Dairy");
    expect(moved.body.name).not.toBe(bananas.name);
    expect(back.body.section ?? "").toBe("");
    expect(await api.vaultFile("Lists/Shopping.md")).toBe(
      "- [ ] Bananas\n\n## Produce\n- [x] Lemons\n\n## Dairy\n- [ ] Oat milk (2)\n",
    );
  });

  test("deletes an item and clears the ticked ones", async () => {
    const bananas = await item("Bananas");

    expect((await api.call(`/v1/${bananas.name}`, "DELETE")).status).toBe(200);
    const cleared = await api.call("/v1/lists/shopping:clearDone", "POST", {});

    expect(cleared.body.openCount).toBe(1);
    expect(await api.vaultFile("Lists/Shopping.md")).toBe(
      "## Produce\n\n## Dairy\n- [ ] Oat milk (2)\n",
    );
  });

  test("an etag from before an edit in Obsidian is refused", async () => {
    const { etag } = await shopping();
    await Bun.write(join(api.dir, "vault/Lists/Shopping.md"), `${SHOPPING}- [ ] Tea\n`);

    const { status, body } = await api.call("/v1/lists/shopping/items", "POST", {
      texts: ["Bread"],
      etag,
    });

    expect(status).toBe(409);
    expect(body.code).toBe("aborted");
  });

  test("Connect serves the same lists", async () => {
    const { status, body } = await api.call("/dashboardify.v1.ListService/ListLists", "POST", {});

    expect(status).toBe(200);
    expect(body.lists[0].title).toBe("Shopping");
  });
});
