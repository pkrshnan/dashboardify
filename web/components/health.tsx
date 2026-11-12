// Home's health trends: fifteen metrics in four groups (heart, sleep, activity, vitals), one line
// colour per group. The range switch changes only the charts, never the numbers. The Health page
// (web/modules/health.tsx) reuses the row and the status line.

import { useState } from "preact/hooks";
import { LOW_BATTERY_PCT } from "../../src/health/battery";
import { lag, shortDuration } from "../../src/health/sync";
import type { BatteryView, HealthGroup, HealthSyncView, MetricTrend } from "../../src/home/types";
import { chartShape, type Range, rangeLabel, WIDTH } from "../lib/chart";
import { nowIn } from "../lib/clock";
import { HEALTH, STATUS, toneColor } from "../lib/colors";
import { dayMonth } from "../lib/format";
import { href } from "../lib/router";
import { Segmented } from "./segmented";

export const RANGES: { value: Range; label: string }[] = [
  { value: "2w", label: "2W" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
];

/** Desktop columns: heart and sleep on the left, activity and vitals on the right. */
const COLUMNS: HealthGroup[][] = [
  ["heart", "sleep"],
  ["activity", "vitals"],
];

export function Health({
  metrics,
  date,
  sync,
  timeZone,
  isPhone,
  opens = new Set(),
  onOpen,
}: {
  metrics: MetricTrend[];
  date: string;
  sync: HealthSyncView | null;
  timeZone: string;
  isPhone: boolean;
  /** Keys of the rows that open a detail when tapped, such as the sleep rows. */
  opens?: Set<string>;
  onOpen?: (key: string) => void;
}) {
  const [range, setRange] = useState<Range>("1m");
  const group = (g: HealthGroup) => (
    <div key={g} class="health-group">
      {metrics
        .filter((m) => m.group === g)
        .map((m) => (
          <Metric
            key={m.key}
            metric={m}
            range={range}
            isPhone={isPhone}
            onOpen={onOpen && opens.has(m.key) ? () => onOpen(m.key) : undefined}
          />
        ))}
    </div>
  );
  return (
    <section class="section">
      <div class="section-head">
        <div class="health-title">
          <h2>
            <a class="title-link" href={href("/health")}>
              Health
            </a>
          </h2>
          <a class="section-link" href={href("/activity")}>
            Activity ›
          </a>
          <HealthStatus date={date} range={range} sync={sync} timeZone={timeZone} />
        </div>
        <Segmented label="Trend range" segments={RANGES} value={range} onChange={setRange} />
      </div>
      <div class="health-cols">
        {COLUMNS.map((col) => (
          <div key={col.join()} class="health-col">
            {col.map(group)}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The range's dates, then when the strap last synced and its battery. */
export function HealthStatus(props: {
  date: string;
  range: Range;
  sync: HealthSyncView | null;
  timeZone: string;
}) {
  const { sync, timeZone } = props;
  return (
    <div class="range-label">
      {rangeLabel(props.date, props.range)}
      {sync && <Synced sync={sync} timeZone={timeZone} />}
      {sync?.battery && <Battery battery={sync.battery} timeZone={timeZone} />}
    </div>
  );
}

/** "Synced 14:02" while data is fresh; "Synced 5h ago" in orange once it lags. */
function Synced({ sync, timeZone }: { sync: HealthSyncView; timeZone: string }) {
  const latest = new Date(sync.latestSample);
  const behind = lag(latest.getTime(), Date.now());
  const at = nowIn(timeZone, latest);
  const when = at.date === nowIn(timeZone).date ? at.time : `${dayMonth(at.date)} ${at.time}`;
  const uploaded = nowIn(timeZone, new Date(sync.upload));
  return (
    <span
      class="synced"
      title={`Uploaded ${uploaded.date} ${uploaded.time}`}
      style={behind === null ? undefined : { color: STATUS.warn }}
    >
      {behind === null ? `Synced ${when}` : `Synced ${shortDuration(behind)} ago`}
    </span>
  );
}

/** "Strap 64%", with a bolt while charging; orange once it runs low off the charger. */
function Battery({ battery, timeZone }: { battery: BatteryView; timeZone: string }) {
  const percent = Math.round(battery.percent);
  const low = !battery.charging && battery.percent <= LOW_BATTERY_PCT;
  const at = nowIn(timeZone, new Date(battery.at));
  return (
    <span
      class="battery"
      title={`Battery reported ${at.date} ${at.time}`}
      style={low ? { color: STATUS.warn } : undefined}
    >
      {battery.charging ? `Strap ${percent}% ⚡` : `Strap ${percent}%`}
    </span>
  );
}

/** One trend row: name, value and change, then its chart. The Health page reuses it. */
export function Metric({
  metric,
  range,
  isPhone,
  onOpen,
}: {
  metric: MetricTrend;
  range: Range;
  isPhone: boolean;
  onOpen?: () => void;
}) {
  const value = (
    <span class="metric-value">
      {metric.value ?? "–"}
      {metric.unit && metric.value && <span class="unit">{metric.unit}</span>}
    </span>
  );
  const delta = (
    <span>
      {metric.delta && <span style={{ color: toneColor(metric.tone) }}>{metric.delta}</span>}
      {metric.partial && (
        <span class="muted">
          {metric.delta && " · "}
          {yesterdayLabel(metric)}
        </span>
      )}
    </span>
  );
  const body = (
    <>
      {isPhone ? (
        <span class="metric-row">
          <span class="metric-name">{metric.name}</span>
          <span class="metric-delta">{delta}</span>
          {value}
        </span>
      ) : (
        <span class="metric-text">
          <span class="metric-name">{metric.name}</span>
          {value}
          <span class="metric-delta">{delta}</span>
        </span>
      )}
      <Sparkline metric={metric} range={range} isPhone={isPhone} />
    </>
  );
  // A row that opens a detail is a button; the others are plain, so they don't look tappable.
  return onOpen ? (
    <button type="button" class="metric opens" onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div class="metric">{body}</div>
  );
}

/** "9,840 yesterday", "42 min yesterday", or "– yesterday" without data. */
function yesterdayLabel(metric: MetricTrend): string {
  const value = metric.yesterdayValue ?? "–";
  return `${value}${metric.unit && metric.yesterdayValue ? ` ${metric.unit}` : ""} yesterday`;
}

function Sparkline({
  metric,
  range,
  isPhone,
}: {
  metric: MetricTrend;
  range: Range;
  isPhone: boolean;
}) {
  const shape = chartShape(metric, range);
  const color = HEALTH[metric.group];
  return (
    <svg
      viewBox={`0 0 ${WIDTH} 100`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${metric.name} over the selected range, with your normal range shaded`}
    >
      {shape.band && (
        <rect
          x="0"
          y={shape.band.y}
          width={WIDTH}
          height={shape.band.height}
          fill={color}
          fill-opacity="0.13"
        />
      )}
      <Dots d={shape.dots} color={color} width={isPhone ? 2.5 : 3} opacity={0.45} />
      <path
        d={shape.line}
        stroke={color}
        stroke-width={isPhone ? 1.8 : 2}
        stroke-linejoin="round"
        fill="none"
        vector-effect="non-scaling-stroke"
      />
      <Dots d={shape.latest} color={color} width={isPhone ? 5 : 6} opacity={1} />
    </svg>
  );
}

/** Zero-length segments drawn with round caps, so each is a dot. */
function Dots({
  d,
  color,
  width,
  opacity,
}: {
  d: string;
  color: string;
  width: number;
  opacity: number;
}) {
  return (
    <path
      d={d}
      stroke={color}
      stroke-opacity={opacity}
      stroke-width={width}
      stroke-linecap="round"
      fill="none"
      vector-effect="non-scaling-stroke"
    />
  );
}
