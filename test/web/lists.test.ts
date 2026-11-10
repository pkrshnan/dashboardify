import { describe, expect, test } from "bun:test";
import type { ListItemView, ListView } from "../../web/api";
import { doneItems, leftLabel, openSections, withTicks } from "../../web/lib/lists";

function item(text: string, done = false, section = ""): ListItemView {
  return { name: `lists/shopping/items/${text}`, text, note: "", done, section };
}

const SHOPPING: ListView = {
  slug: "shopping",
  title: "Shopping",
  path: "Lists/Shopping.md",
  openCount: 3,
  etag: "e1",
  sections: [
    { title: "", items: [item("Coffee")] },
    {
      title: "Produce",
      items: [item("Bananas", false, "Produce"), item("Lemons", true, "Produce")],
    },
    { title: "Dairy", items: [item("Eggs", true, "Dairy"), item("Milk", false, "Dairy")] },
  ],
};

describe("lists on the page", () => {
  test("open items stay in their sections; done ones are gathered in note order", () => {
    expect(openSections(SHOPPING).map((s) => [s.title, s.items.map((i) => i.text)])).toEqual([
      ["", ["Coffee"]],
      ["Produce", ["Bananas"]],
      ["Dairy", ["Milk"]],
    ]);
    expect(doneItems(SHOPPING).map((i) => i.text)).toEqual(["Lemons", "Eggs"]);
  });

  test("a section with nothing left is dropped", () => {
    const ticked = withTicks(SHOPPING, new Map([["lists/shopping/items/Milk", true]]));

    expect(openSections(ticked).map((s) => s.title)).toEqual(["", "Produce"]);
    expect(doneItems(ticked).map((i) => i.text)).toEqual(["Lemons", "Eggs", "Milk"]);
  });

  test("a tick made here shows before the reload, either way", () => {
    const ticked = withTicks(
      SHOPPING,
      new Map([
        ["lists/shopping/items/Coffee", true],
        ["lists/shopping/items/Lemons", false],
      ]),
    );

    expect(doneItems(ticked).map((i) => i.text)).toEqual(["Coffee", "Eggs"]);
  });

  test("what's left reads the same for any list", () => {
    expect(leftLabel(7)).toBe("7 left");
    expect(leftLabel(0)).toBe("All done");
  });
});
