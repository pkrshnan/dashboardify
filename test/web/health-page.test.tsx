import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render } from "@testing-library/preact";
import { METRICS } from "../../src/home/health-history";
import { trend } from "../../src/home/trends";
import type { HomeView } from "../../src/home/types";
import { AppContext } from "../../web/modules/context";
import { health, healthRange } from "../../web/modules/health";
import { useDom } from "./dom";

useDom();

const TODAY = "2026-11-12";

let asked: string[];
let original: typeof fetch;

beforeEach(() => {
  asked = [];
  original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    const asOf = /asOfDate\.year=(\d+)&asOfDate\.month=(\d+)&asOfDate\.day=(\d+)/.exec(url);
    if (asOf) {
      return Response.json(pastHome(Number(asOf[3])));
    }
    return new Response(JSON.stringify({ code: 5, message: "night not found" }), { status: 404 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

/** GET /v1/home as of a day in November: HRV reads the day's number. */
function pastHome(day: number) {
  return {
    name: "home",
    timeZone: "UTC",
    date: { year: 2026, month: 11, day: 12 },
    metrics: [
      {
        key: "hrv",
        displayName: "HRV",
        unit: "ms",
        group: "heart",
        value: String(40 + day),
        dailyValues: [40 + day],
        lastDate: { year: 2026, month: 11, day },
      },
    ],
  };
}

const view = {
  timeZone: "UTC",
  date: TODAY,
  health: METRICS.map((def) => trend(def, [], TODAY)),
  healthSync: null,
} as unknown as HomeView;

function page(query: Record<string, string>, isPhone: boolean) {
  const View = health.view;
  return (
    <AppContext.Provider value={{ token: "t", onUnauthorized, isPhone }}>
      <View
        route={{ path: "/health", query }}
        params={{}}
        home={{
          view,
          now: { date: TODAY, time: "09:12", minutes: 552 },
          load: () => Promise.resolve(),
        }}
      />
    </AppContext.Provider>
  );
}

// One function for every render, as the shell's is, so a rerender doesn't refetch.
const onUnauthorized = () => undefined;

function showPage(query: Record<string, string> = {}, isPhone = false) {
  const shown = render(page(query, isPhone));
  return { ...shown, show: (next: Record<string, string>) => shown.rerender(page(next, isPhone)) };
}

const names = (el: Element) =>
  [...el.querySelectorAll(".metric-name")].map((n) => n.textContent ?? "");

describe("Health page", () => {
  test("recovery heads the page, then sleep, heart and vitals", () => {
    const page = showPage();

    const sections = [...page.container.querySelectorAll("section")];

    expect(sections.map((s) => s.querySelector("h1, h2")?.textContent)).toEqual([
      "Health",
      "Sleep",
      "Heart",
      "Vitals",
    ]);
    expect(sections.map(names)).toEqual([
      ["Recovery"],
      ["Sleep score", "Time asleep", "Deep sleep", "REM sleep"],
      ["HRV", "Resting HR", "VO2max"],
      ["Breathing rate", "Skin temperature"],
    ]);
  });

  test("shows last night without a night in the address", async () => {
    const page = showPage();

    expect(await page.findByText("No night recorded.")).toBeTruthy();
    expect(page.getByText("Night, 11–12 Nov")).toBeTruthy();
    expect(asked).toEqual([`/v1/days/${TODAY}/night`]);
  });

  test("shows the night the address names", async () => {
    const page = showPage({ night: "2026-11-09" });

    await page.findByText("No night recorded.");

    expect(page.getByText("Night, 8–9 Nov")).toBeTruthy();
    expect(asked).toContain("/v1/days/2026-11-09/night");
  });

  test("the rows are as of last night without asking again", async () => {
    const page = showPage();

    await page.findByText("No night recorded.");

    expect(asked.filter((url) => url.startsWith("/v1/home"))).toEqual([]);
    expect(page.getByText(/ – 12 Nov/)).toBeTruthy();
  });

  test("the rows are as of the night shown, and follow it when it changes", async () => {
    const page = showPage({ night: "2026-11-09" });

    expect(await page.findByText("49")).toBeTruthy();
    expect(asked).toContain("/v1/home?asOfDate.year=2026&asOfDate.month=11&asOfDate.day=9");
    expect(page.getByText("11 Oct – 9 Nov")).toBeTruthy();

    page.show({ night: "2026-11-08" });

    expect(await page.findByText("48")).toBeTruthy();
    expect(asked).toContain("/v1/home?asOfDate.year=2026&asOfDate.month=11&asOfDate.day=8");
    expect(page.getByText("10 Oct – 8 Nov")).toBeTruthy();
  });

  test("the rows are plain, since the night is already showing", () => {
    const page = showPage();

    expect(page.container.querySelector("button.metric")).toBeNull();
  });

  test("the range comes from the address, a month without it", () => {
    expect(healthRange("1y")).toBe("1y");
    expect(healthRange(undefined)).toBe("1m");
    expect(healthRange("week")).toBe("1m");
  });
});
