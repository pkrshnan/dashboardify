import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/preact";
import type { BatteryView, HealthSyncView } from "../../src/home/types";
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
