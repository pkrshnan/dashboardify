import { describe, expect, test } from "bun:test";
import { useApi } from "./helpers";

describe("days API", () => {
  const api = useApi();

  test("masked check-in updates replace tags and preserve feel", async () => {
    await api.call("/v1/days/2026-11-03/checkin", "PATCH", { feel: 4, tags: ["sick"] });

    const updated = await api.call("/v1/days/2026-11-03/checkin?updateMask=tags", "PATCH", {
      tags: ["alcohol"],
    });

    expect(updated.status).toBe(200);
    expect(updated.body.tags).toEqual(["alcohol"]);
    expect(updated.body.feel).toBe(4);
  });
});
