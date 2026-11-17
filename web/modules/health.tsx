// The Health page: a day stepper under the title, then what is live (the night's stages, the day
// since, web/components/day-trace.tsx, recovery and strain), then the heart, sleep and vitals
// trends. The trend rows are home's (web/components/health.tsx), given the page's width. The day
// is the address's `?night=`, today without it; the range is `?range=`. Every row is as of that
// day, so stepping back reads as if that day were today.

import { useEffect, useState } from "preact/hooks";
import type { HealthGroup, HomeView, MetricTrend } from "../../src/home/types";
import { fetchHome, type Token, Unauthorized } from "../api";
import { DayTrace } from "../components/day-trace";
import { HealthStatus, Metric, RANGES } from "../components/health";
import { Night } from "../components/night";
import { Segmented } from "../components/segmented";
import type { Range } from "../lib/chart";
import { addDays, shortDate } from "../lib/format";
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
  nav: { group: 3, phone: "tab" },
  needsHome: true,
  view: HealthPage,
};

/** How well you have recovered and how hard you pushed: under the day, out of their groups. */
const TOP = ["recovery", "strain"];

const SECTIONS: { title: string; group: HealthGroup }[] = [
  { title: "Heart", group: "heart" },
  { title: "Sleep", group: "sleep" },
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
  const top = TOP.flatMap((key) => metrics.filter((m) => m.key === key));
  return (
    <main class="health-page">
      <section class="section">
        <PageHead date={night} range={range} view={view} />
        <Night
          token={token}
          date={night}
          timeZone={view.timeZone}
          onUnauthorized={onUnauthorized}
        />
        <DayTrace
          token={token}
          date={night}
          timeZone={view.timeZone}
          isPhone={isPhone}
          onUnauthorized={onUnauthorized}
        />
        {rows(top)}
      </section>
      {SECTIONS.map(({ title, group }) => (
        <section key={group} class="section">
          <div class="section-head">
            <h2>{title}</h2>
          </div>
          {rows(metrics.filter((m) => m.group === group && !TOP.includes(m.key)))}
        </section>
      ))}
    </main>
  );
}

/** The title, the sync labels as of the night's day, and the trend range. */
function PageHead(props: { date: string; range: Range; view: HomeView }) {
  const { view } = props;
  return (
    <div class="section-head">
      <div class="activity-title">
        <h1>Health</h1>
        <DayStep date={props.date} today={view.date} />
      </div>
      <div class="activity-range">
        <HealthStatus
          date={props.date}
          range={props.range}
          sync={view.healthSync}
          timeZone={view.timeZone}
        />
        <Segmented
          label="Trend range"
          segments={RANGES}
          value={props.range}
          onChange={(r) => setQuery({ range: r === "1m" ? "" : r })}
        />
      </div>
    </div>
  );
}

/**
 * The day the page shows, Today or "Sun 15 Nov": the night that ended that morning, the day
 * since, and every row as of it. Steps replace the history entry, so Back leaves the page.
 */
function DayStep(props: { date: string; today: string }) {
  const { date, today } = props;
  return (
    <div class="day-step">
      <button
        type="button"
        class="link-button"
        aria-label="Day before"
        onClick={() => setQuery({ night: addDays(date, -1) })}
      >
        <Chevron d="M12.5 5l-5 5 5 5" />
      </button>
      <span>{date === today ? "Today" : shortDate(date)}</span>
      <button
        type="button"
        class="link-button"
        aria-label="Day after"
        disabled={date >= today}
        onClick={() => setQuery({ night: addDays(date, 1) === today ? "" : addDays(date, 1) })}
      >
        <Chevron d="M7.5 5l5 5-5 5" />
      </button>
    </div>
  );
}

function Chevron(props: { d: string }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d={props.d} />
    </svg>
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
