import { describe, expect, test } from "bun:test";
import { useApi } from "./helpers";

describe("voice API", () => {
  const api = useApi();

  test("voice RPC creates a task through the service contract", async () => {
    const result = await api.call("/dashboardify.v1.VoiceService/AddTask", "POST", {
      text: "Call Mum tomorrow",
      requestId: "voice",
    });

    expect(result.status).toBe(200);
    expect(result.body.task).toStartWith("tasks/");
  });
});

describe("voice check-in validation", () => {
  const api = useApi();

  test("validates converted scores through the resource schema", async () => {
    const outOfRange = await api.call("/dashboardify.v1.VoiceService/CheckIn", "POST", {
      feel: "6",
    });
    const malformed = await api.call("/dashboardify.v1.VoiceService/CheckIn", "POST", {
      rpe: "bad",
    });
    const zeroEffort = await api.call("/dashboardify.v1.VoiceService/CheckIn", "POST", {
      rpe: "0",
    });

    expect(outOfRange.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(zeroEffort.status).toBe(200);
  });
});

describe("voice add to list", () => {
  const api = useApi();
  const add = (list: string, text: string) =>
    api.call("/dashboardify.v1.VoiceService/AddToList", "POST", { list, text });

  test("adds what was said to the list it names, and says so", async () => {
    await Bun.write(`${api.dir}/vault/Lists/Shopping.md`, "- [ ] Bread\n- [x] Eggs\n");

    const { status, body } = await add("the shopping list", "oat milk and eggs, bread");

    expect(status).toBe(200);
    expect(body).toEqual({
      list: "lists/shopping",
      message: "Added oat milk and eggs to Shopping. Bread was already on it.",
    });
    expect(await api.vaultFile("Lists/Shopping.md")).toBe(
      "- [ ] Bread\n- [ ] Eggs\n- [ ] oat milk\n",
    );
  });

  test("an unknown list is a 404 Siri can read out", async () => {
    await Bun.write(`${api.dir}/vault/Lists/Shopping.md`, "");

    const { status, body } = await add("films", "Dune");

    expect(status).toBe(404);
    expect(body.message).toBe("There's no list called films. Your lists are Shopping.");
  });

  describe("TickHabit", () => {
    const tick = (text: string) =>
      api.call("/dashboardify.v1.VoiceService/TickHabit", "POST", { text });
    const habit = (displayName: string, schedule: object) =>
      api.call("/v1/habits", "POST", { displayName, schedule });

    test("ticks the habit said today and speaks the streak", async () => {
      await habit("Meditate", { kind: "KIND_DAILY" });

      const { status, body } = await tick("I meditated");

      expect(status).toBe(200);
      expect(body).toEqual({ habit: "habits/meditate", message: "Ticked Meditate. 1 day." });
      expect(await api.vaultFile("daily/2026/2026-11-03.md")).toContain("habits:\n  - meditate");
    });

    test("last night ticks yesterday; a weekly habit says how the week is going", async () => {
      await habit("Lift", { kind: "KIND_WEEKLY", timesPerWeek: 3 });

      const { body } = await tick("lifted last night");

      expect(body.message).toBe("Ticked Lift for yesterday. 1 of 3 this week.");
      expect(await api.vaultFile("daily/2026/2026-11-02.md")).toContain("habits:\n  - lift");
    });

    test("a habit that isn't there comes back as a sentence", async () => {
      await habit("Read", { kind: "KIND_DAILY" });

      const { status, body } = await tick("juggled");

      expect(status).toBe(404);
      expect(body.message).toBe("There's no habit called juggled. Your habits are Read.");
    });
  });
});
