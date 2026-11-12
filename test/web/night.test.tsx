import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render } from "@testing-library/preact";
import { METRICS } from "../../src/home/health-history";
import { trend } from "../../src/home/trends";
import { Health } from "../../web/components/health";
import { Night } from "../../web/components/night";
import { NIGHT_ROWS } from "../../web/lib/night";
import { useDom } from "./dom";

useDom();

const at = (time: string) => `2026-11-0${time}:00Z`;

const NIGHT = {
  name: "days/2026-11-03/night",
  bedTime: at("2T23:30"),
  onsetTime: at("2T23:41"),
  wakeTime: at("3T07:05"),
  asleepMinutes: 432,
  sleepScore: 84,
  lightMinutes: 247,
  deepMinutes: 85,
  remMinutes: 100,
  stagesPlausible: false,
  stages: [
    { startTime: at("2T23:30"), endTime: at("2T23:41"), stage: "STAGE_AWAKE" },
    { startTime: at("2T23:41"), endTime: at("3T01:00"), stage: "STAGE_LIGHT" },
    { startTime: at("3T01:00"), endTime: at("3T02:25"), stage: "STAGE_DEEP" },
    { startTime: at("3T02:25"), endTime: at("3T07:05"), stage: "STAGE_REM" },
  ],
};

let status = 200;
let asked: string[];
let original: typeof fetch;

beforeEach(() => {
  status = 200;
  asked = [];
  original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    const body = status === 200 ? NIGHT : { code: 5, message: "night not found" };
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

function showNight(date = "2026-11-03", today = "2026-11-03") {
  const onStep = mock((_: string) => undefined);
  const page = render(
    <Night
      token="t"
      date={date}
      today={today}
      timeZone="Europe/London"
      onStep={onStep}
      onUnauthorized={() => undefined}
    />,
  );
  return { page, onStep };
}

describe("night view", () => {
  test("shows the night's times, stage totals and that they are estimated", async () => {
    const { page } = showNight();

    expect(await page.findByText("Deep 1h 25m · REM 1h 40m · Light 4h 07m")).toBeTruthy();
    expect(page.getByText("Night, 2–3 Nov")).toBeTruthy();
    expect(page.container.querySelector(".night-times")?.textContent).toStartWith("23:41–07:05");
    expect(page.container.querySelector(".night-note")?.textContent).toBe(
      "Estimated · unusual night",
    );
    expect(asked).toEqual(["/v1/days/2026-11-03/night"]);
  });

  test("draws one bar per stage run, each in its lane", async () => {
    const { page } = showNight();
    await page.findByText(/^Deep 1h 25m/);

    const bars = [...page.container.querySelectorAll(".hypnogram rect")];

    expect(bars).toHaveLength(4);
    expect(bars.map((b) => Number(b.getAttribute("y")))).toEqual([4, 64, 94, 34]);
  });

  test("a day with no night says so", async () => {
    status = 404;
    const { page } = showNight();

    expect(await page.findByText("No night recorded.")).toBeTruthy();
  });

  test("steps to the night before, and only back to today", async () => {
    const { page, onStep } = showNight();
    await page.findByText(/^Deep 1h 25m/);

    fireEvent.click(page.getByRole("button", { name: "‹ 1–2 Nov" }));

    expect(onStep).toHaveBeenCalledWith("2026-11-02");
    expect(page.queryByRole("button", { name: /›$/ })).toBeNull();
  });
});

describe("sleep rows", () => {
  const metrics = METRICS.map((def) => trend(def, [], "2026-11-03"));

  test("only the sleep rows link to the night", async () => {
    const onOpen = mock((_: string) => undefined);
    const page = render(
      <Health
        metrics={metrics}
        date="2026-11-03"
        sync={null}
        timeZone="UTC"
        isPhone={false}
        opens={NIGHT_ROWS}
        onOpen={onOpen}
      />,
    );

    const buttons = [...page.container.querySelectorAll("button.metric")];
    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: /^Deep sleep/ }));
    });

    expect(buttons.map((b) => b.querySelector(".metric-name")?.textContent)).toEqual([
      "Sleep score",
      "Time asleep",
      "Deep sleep",
      "REM sleep",
    ]);
    expect(onOpen).toHaveBeenCalledWith("deep");
  });
});
