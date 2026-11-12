import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/preact";
import { METRICS } from "../../src/home/health-history";
import { trend } from "../../src/home/trends";
import type { BatteryView, HealthSyncView, MetricTrend } from "../../src/home/types";
import { Health } from "../../web/components/health";
import { useDom } from "./dom";

useDom();

function sync(battery: BatteryView | null): HealthSyncView {
  const now = new Date().toISOString();
  return { latestSample: now, upload: now, battery };
}

function batteryLabel(battery: BatteryView | null) {
  const { container } = render(
    <Health metrics={[]} date="2026-11-09" sync={sync(battery)} timeZone="UTC" isPhone={false} />,
  );
  return container.querySelector<HTMLElement>(".battery");
}

describe("strap battery", () => {
  const at = "2026-11-09T12:00:00Z";

  test("shows the latest percent beside the sync time", () => {
    const label = batteryLabel({ percent: 63.6, charging: false, at });

    expect(label?.textContent).toBe("Strap 64%");
    expect(label?.style.color).toBe("");
  });

  test("turns orange once it runs low off the charger", () => {
    expect(batteryLabel({ percent: 6.4, charging: false, at })?.style.color).not.toBe("");
  });

  test("marks charging and drops the warning", () => {
    const label = batteryLabel({ percent: 6.4, charging: true, at });

    expect(label?.textContent).toBe("Strap 6% ⚡");
    expect(label?.style.color).toBe("");
  });

  test("is left out before the strap reports one", () => {
    expect(batteryLabel(null)).toBeNull();
  });
});

const DATE = "2026-11-09";

/** Every home metric over 70 days, the last week up on the 60 before; calories have no data. */
function metrics(): MetricTrend[] {
  return METRICS.map((def) => {
    const values = Array.from({ length: 70 }, (_, i) => (i >= 63 ? 120 : 100) + (i % 2) * 4);
    return trend(def, def.key === "calories" ? values.map(() => null) : values, DATE);
  });
}

function renderHealth(isPhone: boolean) {
  return render(
    <Health metrics={metrics()} date={DATE} sync={null} timeZone="UTC" isPhone={isPhone} />,
  );
}

const names = (el: Element) =>
  [...el.querySelectorAll(".metric-name")].map((n) => n.textContent ?? "");

describe("health rows", () => {
  test("desktop puts heart and sleep on the left, activity and vitals on the right", () => {
    const { container } = renderHealth(false);

    const [left, right] = [...container.querySelectorAll(".health-col")];

    expect(left && names(left)).toEqual([
      "Recovery",
      "HRV",
      "Resting HR",
      "VO2max",
      "Sleep score",
      "Time asleep",
      "Deep sleep",
      "REM sleep",
    ]);
    expect(right && names(right)).toEqual([
      "Strain",
      "Steps",
      "Zone 2+",
      "Calories",
      "Training load",
      "Breathing rate",
      "Skin temperature",
    ]);
  });

  test("the phone lists all fifteen in the same order", () => {
    const { container } = renderHealth(true);

    expect(names(container)).toHaveLength(15);
    expect(names(container).slice(3, 8)).toEqual([
      "VO2max",
      "Sleep score",
      "Time asleep",
      "Deep sleep",
      "REM sleep",
    ]);
  });

  test("VO2max is coloured by its change; training load stays grey", () => {
    const { container } = renderHealth(false);

    const delta = (name: string) =>
      [...container.querySelectorAll(".metric")]
        .find((m) => m.querySelector(".metric-name")?.textContent === name)
        ?.querySelector<HTMLElement>(".metric-delta span span");

    expect(delta("VO2max")?.style.color).not.toBe(delta("Training load")?.style.color);
    expect(delta("Training load")?.textContent).toMatch(/^\+/);
  });

  test("calories without a profile weight show a dash, as any row without data", () => {
    const { container } = renderHealth(false);

    const calories = [...container.querySelectorAll(".metric")].find(
      (m) => m.querySelector(".metric-name")?.textContent === "Calories",
    );

    expect(calories?.querySelector(".metric-value")?.textContent).toBe("–");
    expect(calories?.querySelector(".metric-delta")?.textContent).toBe("– yesterday");
  });
});
