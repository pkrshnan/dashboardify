import { describe, expect, test } from "bun:test";
import {
  addItems,
  clearDone,
  itemLine,
  moveItem,
  parseList,
  removeItem,
  splitNote,
  updateItem,
} from "../../src/lists/list-note";

const SHOPPING = `# Shopping

- [ ] Coffee beans

## Produce
- [ ] Bananas
- [ ] Spinach (2 bags)
- [x] Lemons
  - the unwaxed ones

## Dairy
- [ ] Oat milk (2)
Some words of my own.
`;

const texts = (text: string) => parseList(text).items.map((i) => `${i.section}: ${i.text}`);
const named = (text: string, name: string) => {
  const item = parseList(text).items.find((i) => i.text === name);
  if (!item) {
    throw new Error(`no ${name}`);
  }
  return item;
};

describe("parseList", () => {
  test("reads sections, items, ticks and notes", () => {
    const list = parseList(SHOPPING);

    expect(list.sections).toEqual([null, "Produce", "Dairy"]);
    expect(texts(SHOPPING)).toEqual([
      "null: Coffee beans",
      "Produce: Bananas",
      "Produce: Spinach",
      "Produce: Lemons",
      "Dairy: Oat milk",
    ]);
    expect(named(SHOPPING, "Spinach").note).toBe("2 bags");
    expect(named(SHOPPING, "Lemons").done).toBe(true);
  });

  test("an item's id survives edits to other lines", () => {
    const before = named(SHOPPING, "Oat milk").id;
    const edited = SHOPPING.replace("- [ ] Bananas", "- [x] Bananas\n- [ ] Apples");

    expect(named(edited, "Oat milk").id).toBe(before);
  });

  test("the same text twice in a section gets two ids", () => {
    const list = parseList("- [ ] Eggs\n- [ ] Eggs\n");

    expect(new Set(list.items.map((i) => i.id)).size).toBe(2);
  });
});

describe("notes", () => {
  test("a trailing (…) is the note; anything else is text", () => {
    expect(splitNote("Spinach (2 bags)")).toEqual({ text: "Spinach", note: "2 bags" });
    expect(splitNote("  Bin bags  ")).toEqual({ text: "Bin bags", note: null });
    expect(splitNote("(2)")).toEqual({ text: "(2)", note: null });
  });

  test("a line is written back the way it was read", () => {
    expect(itemLine({ text: "Spinach", note: "2 bags", done: false })).toBe(
      "- [ ] Spinach (2 bags)",
    );
    expect(itemLine({ text: "Lemons", note: null, done: true })).toBe("- [x] Lemons");
  });
});

describe("addItems", () => {
  test("a new item goes at the end of the top block, before the first section", () => {
    const { text, items } = addItems(SHOPPING, ["Bin bags"]);

    expect(text).toContain("- [ ] Coffee beans\n- [ ] Bin bags\n\n## Produce");
    expect(items.map((i) => i.text)).toEqual(["Bin bags"]);
  });

  test("a ticked item is unticked in its own section", () => {
    const { text, items } = addItems(SHOPPING, ["lemons"]);

    expect(text).toContain("## Produce\n- [ ] Bananas\n- [ ] Spinach (2 bags)\n- [ ] Lemons");
    expect(items[0]?.section).toBe("Produce");
  });

  test("an open item isn't added twice", () => {
    expect(addItems(SHOPPING, ["bananas"]).text).toBe(SHOPPING);
  });

  test("several at once, each with its own note", () => {
    const { items } = addItems(SHOPPING, ["Eggs (6)", "  ", "Bread"]);

    expect(items.map((i) => [i.text, i.note])).toEqual([
      ["Eggs", "6"],
      ["Bread", null],
    ]);
  });

  test("a list with only a title gets its first item after a blank line", () => {
    expect(addItems("# Packing\n", ["Passport"]).text).toBe("# Packing\n\n- [ ] Passport\n");
  });

  test("a note that starts with a section gets a blank line before it", () => {
    expect(addItems("## Produce\n- [ ] Kale\n", ["Tea"]).text).toBe(
      "- [ ] Tea\n\n## Produce\n- [ ] Kale\n",
    );
  });

  test("a list without sections takes new items at the end", () => {
    expect(addItems("- [ ] Dune\n", ["Arrival"]).text).toBe("- [ ] Dune\n- [ ] Arrival\n");
  });
});

describe("sections", () => {
  test("an item added to a section goes at its end, matching the heading's case", () => {
    const { text, items } = addItems(SHOPPING, ["Kale"], "produce");

    expect(text).toContain("  - the unwaxed ones\n- [ ] Kale\n\n## Dairy");
    expect(items[0]?.section).toBe("Produce");
  });

  test("a new section is a heading at the end of the note", () => {
    const { text } = addItems(SHOPPING, ["Bin bags", "Foil"], "Household");

    expect(text).toBe(`${SHOPPING}\n## Household\n- [ ] Bin bags\n- [ ] Foil\n`);
    expect(addItems("", ["Tea"], "Pantry").text).toBe("## Pantry\n- [ ] Tea\n");
  });

  test("an empty heading takes the item under it", () => {
    expect(addItems("## Bakery\n\n## Dairy\n", ["Bread"], "Bakery").text).toBe(
      "## Bakery\n- [ ] Bread\n\n## Dairy\n",
    );
  });

  test("a ticked match moves to the section it was added to", () => {
    const { text, items } = addItems(SHOPPING, ["Lemons"], "Dairy");

    expect(text).toContain("- [ ] Oat milk (2)\n- [ ] Lemons\n  - the unwaxed ones\n");
    expect(text).not.toContain("- [x] Lemons");
    expect(items[0]?.section).toBe("Dairy");
  });

  test("moving takes the indented lines along and gives a new id", () => {
    const lemons = named(SHOPPING, "Lemons");
    const moved = moveItem(SHOPPING, lemons.id, null);

    expect(moved?.text).toContain(
      "- [ ] Coffee beans\n- [x] Lemons\n  - the unwaxed ones\n\n## Produce\n- [ ] Bananas\n- [ ] Spinach (2 bags)\n\n## Dairy",
    );
    expect(moved?.item.section).toBeNull();
    expect(moved?.item.id).not.toBe(lemons.id);
    expect(moveItem(SHOPPING, lemons.id, "PRODUCE")?.text).toBe(SHOPPING);
    expect(moveItem(SHOPPING, "nope", null)).toBeNull();
  });

  test("an update can move and tick at once", () => {
    const result = updateItem(SHOPPING, named(SHOPPING, "Coffee beans").id, {
      done: true,
      section: "Pantry",
    });

    expect(result?.text).toContain("## Pantry\n- [x] Coffee beans\n");
    expect(result?.item).toMatchObject({ section: "Pantry", done: true });
  });
});

describe("editing", () => {
  test("ticking, renaming and noting one item", () => {
    const id = named(SHOPPING, "Bananas").id;

    const ticked = updateItem(SHOPPING, id, { done: true });
    const renamed = updateItem(SHOPPING, id, { text: "Plantains", note: "ripe" });

    expect(ticked?.text).toContain("- [x] Bananas");
    expect(renamed?.text).toContain("- [ ] Plantains (ripe)");
    expect(renamed?.item.id).not.toBe(id);
    expect(updateItem(SHOPPING, "nope", { done: true })).toBeNull();
  });

  test("removing one item leaves every other line", () => {
    const text = removeItem(SHOPPING, named(SHOPPING, "Spinach").id);

    expect(text).toBe(SHOPPING.replace("- [ ] Spinach (2 bags)\n", ""));
  });

  test("clearing removes ticked items with their indented lines, and nothing else", () => {
    const { text, removed } = clearDone(SHOPPING);

    expect(removed).toBe(1);
    expect(text).toBe(SHOPPING.replace("- [x] Lemons\n  - the unwaxed ones\n", ""));
    expect(text).toContain("Some words of my own.");
  });
});
