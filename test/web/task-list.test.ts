import { describe, expect, test } from "bun:test";
import type { TaskGroup } from "../../src/home/types";
import { listedGroups } from "../../web/components/task-list";

const groups: TaskGroup[] = ["Overdue", "Today", "This week", "Later"].map((name) => ({
  name: name as TaskGroup["name"],
  tasks: [{ id: name, text: name, meta: "" }],
}));

describe("listedGroups", () => {
  test("beside the Day view, every group", () => {
    expect(listedGroups(groups, false).map((g) => g.name)).toEqual([
      "Overdue",
      "Today",
      "This week",
      "Later",
    ]);
  });

  test("beside the Week view, all but This week, which the columns already show", () => {
    expect(listedGroups(groups, true).map((g) => g.name)).toEqual(["Overdue", "Today", "Later"]);
  });
});
