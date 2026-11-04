// Health trends: ten metrics in four groups (heart, sleep, activity, vitals), one line colour per
// group. The range switch changes only the charts, never the numbers.

import { useState } from "preact/hooks";
import type { HealthGroup, MetricTrend } from "../../src/home/types";
import { chartShape, type Range, rangeLabel, WIDTH } from "../lib/chart";
import { HEALTH, toneColor } from "../lib/colors";
import { Segmented } from "./segmented";

const RANGES: { value: Range; label: string }[] = [
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
  isPhone,
}: {
  metrics: MetricTrend[];
  date: string;
  isPhone: boolean;
}) {
  const [range, setRange] = useState<Range>("1m");
  const group = (g: HealthGroup) => (
    <div key={g} class="health-group">
      {metrics
        .filter((m) => m.group === g)
        .map((m) => (
          <Metric key={m.key} metric={m} range={range} isPhone={isPhone} />
        ))}
    </div>
  );
  return (
    <section class="section">
      <div class="section-head">
        <div class="health-title">
          <h2>Health</h2>
          <div class="range-label">{rangeLabel(date, range)}</div>
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

function Metric({
  metric,
  range,
  isPhone,
}: {
  metric: MetricTrend;
  range: Range;
  isPhone: boolean;
}) {
  const value = (
    <div class="metric-value">
      {metric.value ?? "–"}
      {metric.unit && metric.value && <span class="unit">{metric.unit}</span>}
    </div>
  );
  const delta = (
    <span>
      {metric.delta && <span style={{ color: toneColor(metric.tone) }}>{metric.delta}</span>}
      {metric.yesterday && <span class="muted"> · yesterday</span>}
    </span>
  );
  return (
    <div class="metric">
      {isPhone ? (
        <div class="metric-row">
          <span class="metric-name">{metric.name}</span>
          <span class="metric-delta">{delta}</span>
          {value}
        </div>
      ) : (
        <div>
          <div class="metric-name">{metric.name}</div>
          {value}
          <div class="metric-delta">{delta}</div>
        </div>
      )}
      <Sparkline metric={metric} range={range} isPhone={isPhone} />
    </div>
  );
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
      <path
        d={shape.dots}
        stroke={color}
        stroke-opacity="0.45"
        stroke-width={isPhone ? 2.5 : 3}
        stroke-linecap="round"
        fill="none"
        vector-effect="non-scaling-stroke"
      />
      <path
        d={shape.line}
        stroke={color}
        stroke-width={isPhone ? 1.8 : 2}
        stroke-linejoin="round"
        fill="none"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  );
}
