import { describe, expect, test } from "bun:test";
import { MODULES, MORE, pageFor } from "../../web/modules/index";

describe("modules", () => {
  test("ids, paths and shortcut letters are each used once", () => {
    for (const field of ["id", "path", "key"] as const) {
      const values = [...MODULES, MORE].map((m) => m[field]);

      expect(new Set(values).size).toBe(values.length);
    }
  });

  test("Today comes first, so it heads the sidebar", () => {
    expect(MODULES[0]?.id).toBe("today");
  });
});

describe("pageFor", () => {
  test.each([
    ["/", "today", {}],
    ["/activity", "activity", {}],
    ["/settings", "settings", {}],
    ["/settings/devices", "settings", { section: "devices" }],
    ["/nowhere", "today", {}],
    ["/activity/extra", "today", {}],
    ["/more", "more", {}],
    ["/lists", "lists", {}],
    ["/lists/shopping", "lists", { list: "shopping" }],
  ])("%s shows %s", (path, id, params) => {
    const page = pageFor(path);

    expect(page.module.id).toBe(id);
    expect(page.params).toEqual(params);
  });
});
