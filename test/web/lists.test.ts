import { describe, expect, test } from "bun:test";
import type { HomeView } from "../../src/home/types";
import type { ListItemView, ListView } from "../../web/api";
import {
  doneItems,
  dropSections,
  edgeScroll,
  leftLabel,
  openSections,
  sectionAt,
  stepSection,
  taskList,
  withMove,
  withTicks,
} from "../../web/lib/lists";

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

  test("while dragging, every section takes a drop, even an empty one", () => {
    const ticked = withTicks(SHOPPING, new Map([["lists/shopping/items/Milk", true]]));
    const noTop = { ...ticked, sections: ticked.sections.slice(1) };

    expect(dropSections(ticked).map((s) => [s.title, s.items.length])).toEqual([
      ["", 1],
      ["Produce", 1],
      ["Dairy", 0],
    ]);
    expect(dropSections(noTop).map((s) => s.title)).toEqual(["", "Produce", "Dairy"]);
  });

  test("a drop lands in the section under it, else the nearest", () => {
    const boxes = [
      { title: "", top: 100, bottom: 150 },
      { title: "Produce", top: 170, bottom: 260 },
    ];

    expect(sectionAt(boxes, 120)).toBe("");
    expect(sectionAt(boxes, 200)).toBe("Produce");
    expect(sectionAt(boxes, 163)).toBe("Produce");
    expect(sectionAt(boxes, 20)).toBe("");
    expect(sectionAt(boxes, 900)).toBe("Produce");
    expect(sectionAt([], 0)).toBeNull();
  });

  test("the arrow keys step through the sections and stop at either end", () => {
    expect(stepSection(["Produce", "Dairy"], "", 1)).toBe("Produce");
    expect(stepSection(["Produce", "Dairy"], "Dairy", -1)).toBe("Produce");
    expect(stepSection(["Produce", "Dairy"], "Produce", -1)).toBe("");
    expect(stepSection(["Produce", "Dairy"], "", -1)).toBeNull();
    expect(stepSection(["Produce", "Dairy"], "Dairy", 1)).toBeNull();
  });

  test("a drag near the window's edge scrolls toward it", () => {
    expect(edgeScroll(30, 800)).toBe(-12);
    expect(edgeScroll(400, 800)).toBe(0);
    expect(edgeScroll(770, 800)).toBe(12);
  });

  test("a move shows at the end of its new section before the reload", () => {
    const moved = withMove(SHOPPING, "lists/shopping/items/Coffee", "Dairy");
    const back = withMove(
      { ...SHOPPING, sections: SHOPPING.sections.slice(1) },
      "lists/shopping/items/Milk",
      "",
    );

    expect(moved.sections.map((s) => [s.title, s.items.map((i) => i.text)])).toEqual([
      ["", []],
      ["Produce", ["Bananas", "Lemons"]],
      ["Dairy", ["Eggs", "Milk", "Coffee"]],
    ]);
    expect(back.sections[0]?.items.map((i) => i.text)).toEqual(["Milk"]);
  });
});

describe("taskList", () => {
  const view = {
    date: "2026-11-14",
    days: [
      {
        date: "2026-11-14",
        reminders: [
          { id: "late", text: "Pharmacy", time: "17:30", minutes: 1050, done: false },
          { id: "early", text: "Call Fetch", time: "09:00", minutes: 540, done: true },
        ],
      },
    ],
    tasks: [
      { name: "Someday", tasks: [{ id: "s1", text: "Fix the bike", meta: "" }] },
      { name: "Overdue", tasks: [{ id: "o1", text: "Call the bank", meta: "3d late" }] },
      { name: "Today", tasks: [{ id: "t1", text: "Return the adapter", meta: "" }] },
    ],
  } as unknown as HomeView;
  const titles = (list: ListView) =>
    list.sections.map((s) => [s.title, s.items.map((i) => `${i.text}${i.done ? " ✓" : ""}`)]);

  test("groups in order, today's timed tasks first under Today, the due date as the note", () => {
    const list = taskList(view);

    expect(list.slug).toBe("tasks");
    expect(titles(list)).toEqual([
      ["Overdue", ["Call the bank"]],
      ["Today", ["Call Fetch ✓", "Pharmacy", "Return the adapter"]],
      ["Someday", ["Fix the bike"]],
    ]);
    expect(list.sections[1]?.items[1]?.note).toBe("17:30");
    expect(list.openCount).toBe(4);
  });

  test("tasks ticked here come back done in their group, unless the id is open again", () => {
    const ticked = (name: string, text: string, section: string): ListItemView => ({
      name,
      text,
      note: "",
      done: false,
      section,
    });

    const list = taskList(view, [
      ticked("w1", "Book the dentist", "This week"),
      ticked("s1", "Fix the bike", "Someday"),
    ]);

    expect(titles(list)).toContainEqual(["This week", ["Book the dentist ✓"]]);
    expect(titles(list)).toContainEqual(["Someday", ["Fix the bike"]]);
  });
});
