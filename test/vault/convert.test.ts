import { describe, expect, test } from "bun:test";
import { convertHabits, convertTasks } from "../../src/vault/convert";

describe("convertTasks", () => {
  const Old = [
    "# Inbox",
    "- [x] Call Fetch ⏰ 12:00 📅 2026-11-04 ➕ 2026-11-03 ✅ 2026-11-09 🆔 a7efea",
    "\t- ask about the refund",
    "- [ ] Water plants 🔁 every week 📅 2026-11-14 ⏫",
    "- [ ] Buy 📅 calendar for desk",
    "- [ ] Return adapter <!-- id:b16696 -->",
    "\t- due: 2026-11-19",
    "",
  ].join("\n");

  test("rewrites only old lines and keeps everything else", () => {
    const { text, changes } = convertTasks(Old);

    expect(text).toBe(
      [
        "# Inbox",
        "- [x] Call Fetch <!-- id:a7efea -->",
        "\t- due: 2026-11-04 12:00",
        "\t- done: 2026-11-09",
        "\t- ask about the refund",
        "- [ ] Water plants",
        "\t- due: 2026-11-14",
        "\t- repeat: every week",
        "\t- priority: high",
        "- [ ] Buy 📅 calendar for desk",
        "- [ ] Return adapter <!-- id:b16696 -->",
        "\t- due: 2026-11-19",
        "",
      ].join("\n"),
    );
    expect(changes.map((c) => c.before[0])).toEqual([Old.split("\n")[1], Old.split("\n")[3]]);
  });

  test("a second run changes nothing", () => {
    expect(convertTasks(convertTasks(Old).text).changes).toEqual([]);
  });
});

describe("convertHabits", () => {
  test("moves `·` fields to bullets and leaves plain lines alone", () => {
    const old =
      "# Habits\n\n- Gym · 4 a week · auto lifting ≥ 1 · #BF5AF2 <!-- id:gym -->\n- Stretch\n";

    const { text } = convertHabits(old);

    expect(text).toBe(
      "# Habits\n\n- Gym <!-- id:gym -->\n\t- schedule: 4 a week\n\t- auto: lifting ≥ 1\n\t- colour: BF5AF2\n- Stretch\n",
    );
    expect(convertHabits(text).changes).toEqual([]);
  });
});
