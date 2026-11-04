import { describe, expect, test } from "bun:test";
import { useApi } from "./helpers";

describe("samples API", () => {
  const api = useApi();

  const payload = {
    day: { year: 2026, month: 11, day: 3 },
    timestamps: ["1793664000000", "1793664001000"],
    columns: [{ name: "bpm", numbers: { values: [60, 0] }, missingRows: [1] }],
  };

  test("ingests a typed stream and exposes its schema", async () => {
    const stored = await api.call("/v1/streams/heart_rate:mergeSamples", "POST", payload);
    const stream = await api.call("/v1/streams/heart_rate");
    const listed = await api.call("/v1/streams");

    expect(stored.status).toBe(200);
    expect(stored.body.rows).toBe("2");
    expect(stream.body.columns[0].type).toBe("TYPE_NUMBER");
    expect(listed.body.streams).toHaveLength(1);
  });

  test("rejects timestamps outside the stated UTC day", async () => {
    const response = await api.call("/v1/streams/heart_rate:mergeSamples", "POST", {
      ...payload,
      timestamps: ["0"],
    });

    expect(response.status).toBe(400);
  });
});
