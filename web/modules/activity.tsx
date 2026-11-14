// The Activity page: workouts and walks (web/components/activity.tsx). It needs the home view
// for the server's time zone and today's date; the range is the address's `?range=`, and
// `?day=YYYY-MM-DD` opens on that day (the Lifting page links its sessions here).

import { Activity } from "../components/activity";
import { type Range, rangeShowing } from "../lib/activity";
import { setQuery } from "../lib/use-route";
import { useApp } from "./context";
import type { Module, PageProps } from "./types";

export const activity: Module = {
  id: "activity",
  title: "Activity",
  icon: "activity",
  path: "/activity",
  key: "a",
  nav: { group: 3, phone: "more" },
  needsHome: true,
  view: ActivityPage,
};

function ActivityPage({ route, home }: PageProps) {
  const { token, onUnauthorized } = useApp();
  if (!home) {
    return null;
  }
  const day = shownDay(route.query.day, home.view.date);
  // A linked day widens the range enough to show it, unless the address names one.
  const range =
    route.query.range || !day
      ? activityRange(route.query.range)
      : rangeShowing(day, home.view.date);
  return (
    <Activity
      token={token}
      timeZone={home.view.timeZone}
      today={home.view.date}
      day={day}
      range={range}
      onRange={(range) => setQuery({ range: range === "week" ? "" : range })}
      onUnauthorized={onUnauthorized}
    />
  );
}

/** `?range=`; the week when it is missing or unknown. */
export function activityRange(value: string | undefined): Range {
  return value === "month" || value === "3m" ? value : "week";
}

/** `?day=`, when it's a real day no later than today. */
export function shownDay(value: string | undefined, today: string): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= today ? value : undefined;
}
