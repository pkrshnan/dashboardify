import { describe, expect, test } from "bun:test";
import { SetupCode } from "../../src/settings/setup-code";

describe("SetupCode", () => {
  test("is eight characters without look-alikes, shown in two halves", () => {
    const code = new SetupCode().issue();

    expect(code).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
  });

  test("works once, ignoring case and the dash", () => {
    const setup = new SetupCode();
    const code = setup.issue();

    expect(setup.redeem("nope-nope")).toBe(false);
    expect(setup.redeem(code.toLowerCase().replace("-", ""))).toBe(true);
    expect(setup.redeem(code)).toBe(false);
    expect(setup.active()).toBe(false);
  });

  test("expires after 15 minutes", () => {
    let now = new Date("2026-11-08T09:00:00Z");
    const setup = new SetupCode(() => now);
    const code = setup.issue();

    now = new Date("2026-11-08T09:15:01Z");

    expect(setup.active()).toBe(false);
    expect(setup.redeem(code)).toBe(false);
  });

  test("is not active until issued", () => {
    expect(new SetupCode().active()).toBe(false);
  });
});
