import { describe, expect, test } from "bun:test";
import { fetchHome } from "../../web/api";
import { useApi } from "../server/api/helpers";

describe("home UI API adapter", () => {
  const api = useApi();

  test("home UI adapter preserves the presentation model", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) =>
      api.app.request(url, init)) as typeof fetch;
    try {
      const modern = await fetchHome("secret");
      const legacy = await api.call("/api/home");

      expect(modern).toEqual(legacy.body);
    } finally {
      globalThis.fetch = original;
    }
  });
});
