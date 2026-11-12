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
});
