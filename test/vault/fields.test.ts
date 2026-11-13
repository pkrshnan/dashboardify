import { describe, expect, test } from "bun:test";
import { fieldLines, formatFields, readFields, replaceItem } from "../../src/vault/fields";

const KEYS = ["due", "repeat", "done"] as const;

function lines(text: string): string[] {
  return text.split("\n");
}

describe("readFields", () => {
  test("reads the item's own keys and skips other children", () => {
    const note = lines(
      "- [ ] Call the bank\n\t- due: 2026-11-03 09:00\n\t- ask about fees\n\t- Repeat: every week\n- [ ] Next",
    );
    expect(readFields(note, 0, KEYS)).toEqual({ due: "2026-11-03 09:00", repeat: "every week" });
    expect(readFields(note, 4, KEYS)).toEqual({});
  });

  test("a nested item owns its own fields", () => {
    const note = lines(
      "- [ ] Trip\n\t- due: 2026-12-01\n\t- [ ] Book flights\n\t\t- due: 2026-11-20\n\t- done: 2026-11-10",
    );
    expect(readFields(note, 0, KEYS)).toEqual({ due: "2026-12-01", done: "2026-11-10" });
    expect(readFields(note, 2, KEYS)).toEqual({ due: "2026-11-20" });
  });

  test("spaces work like tabs", () => {
    const note = lines("  - [ ] Nested\n    - due: 2026-11-03\n    - repeat: every day");
    expect(readFields(note, 0, KEYS)).toEqual({ due: "2026-11-03", repeat: "every day" });
  });

  test("the first of a repeated key wins and empty values are skipped", () => {
    const note = lines("- [ ] A\n\t- due:\n\t- due: 2026-11-03\n\t- due: 2026-11-04");
    expect(readFields(note, 0, KEYS)).toEqual({ due: "2026-11-03" });
  });

  test("a blank line or a line no deeper ends the item", () => {
    expect(readFields(lines("- [ ] A\n\n\t- due: 2026-11-03"), 0, KEYS)).toEqual({});
    expect(readFields(lines("- [ ] A\n- due: 2026-11-03"), 0, KEYS)).toEqual({});
  });
});

describe("replaceItem", () => {
  test("rewrites the line and owned fields and keeps the rest", () => {
    const note = lines(
      "# Inbox\n- [ ] A\n\t- note to self\n\t- due: 2026-11-03\n\t- due: 2026-11-04\n- [ ] B",
    );
    replaceItem(note, 1, KEYS, ["- [x] A", ...formatFields({ done: "2026-11-09" }, KEYS, "")]);
    expect(note.join("\n")).toBe(
      "# Inbox\n- [x] A\n\t- done: 2026-11-09\n\t- note to self\n- [ ] B",
    );
  });

  test("an empty replacement deletes the line and its fields", () => {
    const note = lines("- [ ] A\n\t- due: 2026-11-03\n- [ ] B");
    replaceItem(note, 0, KEYS, []);
    expect(note).toEqual(["- [ ] B"]);
  });
});

test("formatFields writes keys in order, one tab deeper, without empty ones", () => {
  expect(formatFields({ done: "2026-11-09", due: "2026-11-03", repeat: "" }, KEYS, "\t")).toEqual([
    "\t\t- due: 2026-11-03",
    "\t\t- done: 2026-11-09",
  ]);
});

test("fieldLines lists the owned lines", () => {
  expect(fieldLines(lines("- [ ] A\n\t- x\n\t- done: 2026-11-09"), 0, KEYS)).toEqual([2]);
});
