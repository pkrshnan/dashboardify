import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DerivedStore } from "../../src/health/derived-store";
import { RawStore } from "../../src/health/raw-store";
import { noCalendar } from "../../src/home/calendar";
import { homeView, storeHomeDeps } from "../../src/home/home";
import { SetupCode } from "../../src/settings/setup-code";
import { TaskStore } from "../../src/vault/task-store";
import { Vault } from "../../src/vault/vault";
import { fetchHome, setUpDevice, Unauthorized } from "../../web/api";
import { useApi } from "../server/api/helpers";

describe("home UI API adapter", () => {
  const api = useApi();

  /** The view the server works out, as JSON, to check the adapter turns GetHome back into it. */
  async function serverView() {
    const deps = storeHomeDeps({
      tasks: new TaskStore(new Vault(join(api.dir, "vault"), "UTC"), "Inbox.md"),
      raw: new RawStore(join(api.dir, "raw")),
      derived: new DerivedStore(join(api.dir, "derived")),
      calendar: noCalendar,
      timeZone: "UTC",
    });
    const view = await homeView(deps, new Date("2026-11-03T12:00:00Z"));
    return JSON.parse(JSON.stringify(view));
  }

  async function compare() {
    const original = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) =>
      api.app.request(url, init)) as typeof fetch;
    try {
      return { modern: await fetchHome("secret"), server: await serverView() };
    } finally {
      globalThis.fetch = original;
    }
  }

  test("home UI adapter keeps the health sync times", async () => {
    await api.call("/v1/streams/heart_rate:mergeSamples", "POST", {
      day: { year: 2026, month: 11, day: 3 },
      timestamps: ["1793664000000"],
      columns: [{ name: "bpm", numbers: { values: [60] } }],
    });

    const { modern, server } = await compare();

    expect(modern.healthSync?.latestSample).toBe("2026-11-03T00:00:00.000Z");
    expect(modern).toEqual(server);
  });

  test("home UI adapter keeps the strap battery", async () => {
    await api.call("/v1/streams/battery:mergeSamples", "POST", {
      day: { year: 2026, month: 11, day: 3 },
      timestamps: ["1793664000000"],
      columns: [
        { name: "pct", numbers: { values: [6.4] } },
        { name: "charging", missingRows: [0], numbers: { values: [0] } },
      ],
    });

    const { modern, server } = await compare();

    expect(modern.healthSync?.battery).toEqual({
      percent: 6.4,
      charging: false,
      at: "2026-11-03T00:00:00.000Z",
    });
    expect(modern).toEqual(server);
  });

  test("home UI adapter preserves the presentation model", async () => {
    const { modern, server } = await compare();

    expect(modern).toEqual(server);
  });
});

describe("first-run sign-in", () => {
  const setupCode = new SetupCode();
  const api = useApi({ setupCode });

  async function through<T>(run: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) =>
      api.app.request(url, init)) as typeof fetch;
    try {
      return await run();
    } finally {
      globalThis.fetch = original;
    }
  }

  test("a 401 says the server is waiting for its setup code", async () => {
    setupCode.issue();

    const error = await through(() => fetchHome(null).catch((e: unknown) => e));

    expect(error).toBeInstanceOf(Unauthorized);
    expect((error as Unauthorized).setup).toBe(true);
  });

  test("setting up with the code returns a token that signs in", async () => {
    const code = setupCode.issue();

    const token = await through(() => setUpDevice(code, "Mac"));
    const home = await through(() => fetchHome(token));

    expect(token).toMatch(/^dfy_/);
    expect(home.timeZone).toBe("UTC");
  });
});
