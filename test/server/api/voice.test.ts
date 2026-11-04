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
