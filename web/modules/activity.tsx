// The Activity page: workouts and walks (web/components/activity.tsx). It needs the home view
// for the server's time zone and today's date; the range is the address's `?range=`.

import { Activity } from "../components/activity";
import type { Range } from "../lib/activity";
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
  return (
    <Activity
      token={token}
      timeZone={home.view.timeZone}
      today={home.view.date}
      range={activityRange(route.query.range)}
      onRange={(range) => setQuery({ range: range === "week" ? "" : range })}
      onUnauthorized={onUnauthorized}
    />
  );
}

/** `?range=`; the week when it is missing or unknown. */
export function activityRange(value: string | undefined): Range {
  return value === "month" || value === "3m" ? value : "week";
}
