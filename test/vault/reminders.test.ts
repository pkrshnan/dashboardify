import { describe, expect, test } from "bun:test";
import { applySync, parseReminders, type Reminder, renderReminders } from "../../src/vault/reminders";

const r = (id: string, title: string, extra: Partial<Reminder> = {}): Reminder => ({
  id,
  title,
  list: "Personal",
  ...extra,
});

describe("render and parse", () => {
  test("round-trips, grouped by list and sorted by due date and time", () => {
    const items = [
      r("b", "Order lenses", { dueDate: "2026-11-05", dueTime: "09:00" }),
      r("a", "Renew lease", { dueDate: "2026-10-31" }),
      r("c", "Call insurance", { dueDate: "2026-11-02", dueTime: "17:00" }),
      r("d", "Buy bulbs", { list: "Home" }),
    ];
    const text = renderReminders(items);
    expect(text).toContain("## Home\n\n- [ ] Buy bulbs <!-- id:d -->\n\n## Personal");
    expect(text).toContain(
      "- [ ] Renew lease 📅 2026-10-31 <!-- id:a -->\n" +
        "- [ ] Call insurance 📅 2026-11-02 ⏰ 17:00 <!-- id:c -->\n" +
        "- [ ] Order lenses 📅 2026-11-05 ⏰ 09:00 <!-- id:b -->",
    );
    expect([...parseReminders(text).values()].sort((x, y) => x.id.localeCompare(y.id))).toEqual(
      items.sort((x, y) => x.id.localeCompare(y.id)),
    );
  });

  test("input order does not change the output", () => {
    const items = [r("a", "One"), r("b", "Two"), r("c", "Three", { list: "Work" })];
    expect(renderReminders([...items].reverse())).toBe(renderReminders(items));
  });

  test("an empty set renders a placeholder and parses back to nothing", () => {
    const text = renderReminders([]);
    expect(text).toContain("_No open reminders._");
    expect(parseReminders(text).size).toBe(0);
  });
});

describe("applySync", () => {
  const current = new Map([
    ["a", r("a", "Renew lease")],
    ["b", r("b", "Call insurance")],
  ]);

  test("full mode adds, updates and removes", () => {
    const { next, diff } = applySync(current, "full", [r("a", "Renew lease"), r("b", "Call insurer"), r("c", "New")]);
    expect(diff).toEqual({ added: ["c"], updated: ["b"], removed: [] });
    expect([...next.keys()]).toEqual(["a", "b", "c"]);
    expect(applySync(current, "full", [r("a", "Renew lease")]).diff.removed).toEqual(["b"]);
  });

  test("changes mode keeps untouched items and drops removed IDs", () => {
    const { next, diff } = applySync(current, "changes", [r("c", "New")], ["a"]);
    expect(diff).toEqual({ added: ["c"], updated: [], removed: ["a"] });
    expect([...next.keys()].sort()).toEqual(["b", "c"]);
  });

  test("an identical full sync reports no changes", () => {
    expect(applySync(current, "full", [...current.values()]).diff).toEqual({ added: [], updated: [], removed: [] });
  });
});
