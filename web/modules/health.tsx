// The Health page: recovery, then sleep (a night's stages over the sleep trends), heart and
// vitals. The trend rows are home's (web/components/health.tsx), given the page's width. The night
// is the address's `?night=`, last night without it; the range is `?range=`.

import type { HealthGroup, MetricTrend } from "../../src/home/types";
import { HealthStatus, Metric, RANGES } from "../components/health";
import { Night } from "../components/night";
import { Segmented } from "../components/segmented";
import type { Range } from "../lib/chart";
import { nightDate } from "../lib/night";
import { setQuery } from "../lib/use-route";
import { useApp } from "./context";
import type { Module, PageProps } from "./types";

export const health: Module = {
  id: "health",
  title: "Health",
  icon: "health",
  path: "/health",
  key: "h",
  nav: { group: 3, phone: "more" },
  needsHome: true,
  view: HealthPage,
};

/** Recovery is in home's heart group; here it heads the page on its own. */
const SECTIONS: { title: string; group: HealthGroup }[] = [
  { title: "Sleep", group: "sleep" },
  { title: "Heart", group: "heart" },
  { title: "Vitals", group: "vitals" },
];

function HealthPage({ route, home }: PageProps) {
  const { token, isPhone, onUnauthorized } = useApp();
  if (!home) {
    return null;
  }
  const { view } = home;
  const range = healthRange(route.query.range);
  const rows = (metrics: MetricTrend[]) => (
    <div class="health-rows">
      {metrics.map((m) => (
        <Metric key={m.key} metric={m} range={range} isPhone={isPhone} />
      ))}
    </div>
  );
  const recovery = view.health.filter((m) => m.key === "recovery");
  return (
    <main class="health-page">
      <section class="section">
        <div class="section-head">
          <div class="activity-title">
            <h1>Health</h1>
          </div>
          <div class="activity-range">
            <HealthStatus
              date={view.date}
              range={range}
              sync={view.healthSync}
              timeZone={view.timeZone}
            />
            <Segmented
              label="Trend range"
              segments={RANGES}
              value={range}
              onChange={(r) => setQuery({ range: r === "1m" ? "" : r })}
            />
          </div>
        </div>
        {rows(recovery)}
      </section>
      {SECTIONS.map(({ title, group }) => (
        <section key={group} class="section">
          <div class="section-head">
            <h2>{title}</h2>
          </div>
          {group === "sleep" && (
            <Night
              token={token}
              date={nightDate(route.query.night, view.date)}
              today={view.date}
              timeZone={view.timeZone}
              onStep={(date) => setQuery({ night: date })}
              onUnauthorized={onUnauthorized}
            />
          )}
          {rows(view.health.filter((m) => m.group === group && m.key !== "recovery"))}
        </section>
      ))}
    </main>
  );
}

/** `?range=`; a month when it is missing or unknown, as on home. */
export function healthRange(value: string | undefined): Range {
  return RANGES.some((r) => r.value === value) ? (value as Range) : "1m";
}
