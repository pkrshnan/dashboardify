// The Health page: recovery, then sleep (a night's stages over the sleep trends), heart and
// vitals. The trend rows are home's (web/components/health.tsx), given the page's width. The night
// is the address's `?night=`, last night without it; the range is `?range=`. Every row is as of
// the night's day, so stepping back a night reads as if that day were today.

import { useEffect, useState } from "preact/hooks";
import type { HealthGroup, MetricTrend } from "../../src/home/types";
import { fetchHome, type Token, Unauthorized } from "../api";
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
  const night = nightDate(route.query.night, view.date);
  const metrics = useTrendsAsOf(token, night, view.health, view.date, onUnauthorized);
  const rows = (metrics: MetricTrend[]) => (
    <div class="health-rows">
      {metrics.map((m) => (
        <Metric key={m.key} metric={m} range={range} isPhone={isPhone} />
      ))}
    </div>
  );
  const recovery = metrics.filter((m) => m.key === "recovery");
  return (
    <main class="health-page">
      <section class="section">
        <div class="section-head">
          <div class="activity-title">
            <h1>Health</h1>
          </div>
          <div class="activity-range">
            <HealthStatus
              date={night}
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
              date={night}
              today={view.date}
              timeZone={view.timeZone}
              onStep={(date) => setQuery({ night: date })}
              onUnauthorized={onUnauthorized}
            />
          )}
          {rows(metrics.filter((m) => m.group === group && m.key !== "recovery"))}
        </section>
      ))}
    </main>
  );
}

/** `?range=`; a month when it is missing or unknown, as on home. */
export function healthRange(value: string | undefined): Range {
  return RANGES.some((r) => r.value === value) ? (value as Range) : "1m";
}

/**
 * The trends ending on `day`. Today's come with the home view; a past day's are fetched, and the
 * rows keep the last ones they had until they arrive, so stepping doesn't blank the page.
 */
function useTrendsAsOf(
  token: Token,
  day: string,
  todays: MetricTrend[],
  today: string,
  onUnauthorized: (setup: boolean) => void,
): MetricTrend[] {
  const [past, setPast] = useState<MetricTrend[] | null>(null);
  useEffect(() => {
    if (day === today) {
      return;
    }
    let live = true;
    fetchHome(token, day).then(
      (view) => live && setPast(view.health),
      (err) => {
        if (err instanceof Unauthorized) {
          onUnauthorized(err.setup);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [token, day, today, onUnauthorized]);
  if (day === today) {
    return todays;
  }
  return past ?? todays;
}
