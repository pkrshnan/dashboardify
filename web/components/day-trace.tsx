// The Health page's day: heart rate, steps and skin temperature over one day, each its own
// chart on the day's 00:00–24:00 axis, with sleep, workouts, walks and time not worn shaded
// behind (docs/day-trace.md). From GET /v1/days/{date}/trace. The SVGs stretch to the width, so
// the scales and hours are HTML and stay readable on a phone. Hovering or dragging on any chart
// picks one minute for all three, and each header reads that minute.

import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { type DayTraceView, fetchDayTrace, type Token, Unauthorized } from "../api";
import { nowIn } from "../lib/clock";
import {
  bandPath,
  barPath,
  type Clock,
  dayMinutes,
  extent,
  HR_RANGE,
  heartRateReading,
  linePath,
  minuteAt,
  type Reading,
  type Scale,
  scale,
  skinTempReading,
  stepsMax,
  stepsReading,
  tempRange,
  total,
  ZONE_COLORS,
  ZONE_SHARES,
  zonePaths,
} from "../lib/day-trace";

interface Props {
  token: Token;
  /** YYYY-MM-DD in the server's time zone. */
  date: string;
  timeZone: string;
  isPhone: boolean;
  onUnauthorized: (setup: boolean) => void;
}

type Loaded = { date: string; trace: DayTraceView | null };

/** No heading of its own: it sits under the night in the Health page's first section. */
export function DayTrace(props: Props) {
  const { token, date, onUnauthorized } = props;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    fetchDayTrace(token, date).then(
      (trace) => live && setLoaded({ date, trace }),
      (err) => {
        if (err instanceof Unauthorized) {
          onUnauthorized(err.setup);
        }
        if (live) {
          setLoaded({ date, trace: null });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [token, date, onUnauthorized]);
  const trace = loaded?.date === date ? loaded.trace : undefined;
  if (trace === undefined) {
    return <p class="muted">Loading…</p>;
  }
  if (trace === null || !hasData(trace)) {
    return <p class="muted">No strap data for this day.</p>;
  }
  return (
    <Charts key={trace.start} trace={trace} timeZone={props.timeZone} isPhone={props.isPhone} />
  );
}

function hasData(trace: DayTraceView): boolean {
  return [trace.heartRate, trace.steps, trace.skinTemp].some((s) =>
    s.values.some((v) => v !== null),
  );
}

const HR_H = { desktop: 220, phone: 200 };
const SMALL_H = { desktop: 130, phone: 110 };

interface ChartProps {
  trace: DayTraceView;
  minutes: number;
  height: number;
  clock: Clock;
  isPhone: boolean;
  /** The minute being read, or null for the latest values. */
  cursor: number | null;
  onPick: (minute: number | null) => void;
}

function Charts(props: { trace: DayTraceView; timeZone: string; isPhone: boolean }) {
  const { trace, isPhone } = props;
  const [cursor, setCursor] = useState<number | null>(null);
  const minutes = dayMinutes(trace);
  const clock: Clock = {
    at: (minute) => nowIn(props.timeZone, new Date(trace.start + minute * 60_000)).time,
    // A past day's range shouldn't say "today".
    sofar: trace.end < trace.start + minutes * 60_000 ? " today" : "",
  };
  const shared = { trace, minutes, clock, isPhone, cursor, onPick: setCursor };
  const size = isPhone ? "phone" : "desktop";
  return (
    <div class="day-trace">
      <Legend />
      <HeartRate {...shared} height={HR_H[size]} />
      <Steps {...shared} height={SMALL_H[size]} />
      <SkinTemp {...shared} height={SMALL_H[size]} />
    </div>
  );
}

function Legend() {
  return (
    <ul class="trace-legend" aria-label="Shading">
      <li class="sleep">Sleep</li>
      <li class="workout">Workout</li>
      <li class="walk">Walk</li>
      <li class="not-worn">Not worn</li>
    </ul>
  );
}

function HeartRate(props: ChartProps) {
  const { trace, height } = props;
  const hr = trace.heartRate;
  const y = scale(HR_RANGE.lo, HR_RANGE.hi, height);
  const day = extent(hr.values);
  const zones = trace.maxHr ? ZONE_SHARES.map((share) => share * (trace.maxHr ?? 0)) : [];
  return (
    <Chart
      title="Heart rate"
      reading={heartRateReading(trace, props.cursor, props.clock)}
      above={props.isPhone ? null : <SpanLabels {...props} />}
      plot={
        <Plot
          {...props}
          label={
            day
              ? `Heart rate per minute, ${Math.round(day.lo)} to ${Math.round(day.hi)} bpm`
              : "Heart rate"
          }
          grid={(zones.length > 0 ? zones : [60, 100, 140, 180]).map((bpm) => ({
            y: y(bpm),
            text: String(Math.round(bpm)),
          }))}
          dashed={zones.length > 0}
          names={zones.map((bpm, i) => ({
            y: y(bpm),
            text: `Z${i + 1}`,
            color: ZONE_COLORS[i + 1] ?? "",
          }))}
        >
          <path d={bandPath(hr.low, hr.high, hr.bucketMin, y)} class="trace-band" />
          {zonePaths(hr, trace.maxHr, y).map((p) => (
            <path key={p.color} d={p.d} stroke={p.color} class="trace-line" />
          ))}
        </Plot>
      }
    />
  );
}

function Steps(props: ChartProps) {
  const { trace, height } = props;
  const most = stepsMax(trace.steps.values);
  const y = scale(0, most, height - 6);
  const shifted: Scale = (v) => y(v) + 6;
  const steps = total(trace.steps.values);
  return (
    <Chart
      title="Steps"
      reading={stepsReading(trace, props.cursor, props.clock)}
      plot={
        <Plot
          {...props}
          label={`Steps per ${trace.steps.bucketMin} minutes, ${steps.toLocaleString("en-US")} in all`}
          grid={[0, most / 2, most].map((s) => ({ y: shifted(s), text: String(s) }))}
        >
          <path d={barPath(trace.steps, shifted, height)} class="trace-bars" />
        </Plot>
      }
    />
  );
}

function SkinTemp(props: ChartProps) {
  const { trace, height } = props;
  const temp = trace.skinTemp;
  const range = tempRange(temp.values);
  const y = scale(range.lo, range.hi, height);
  const day = extent(temp.values);
  const ticks = [range.lo + 1, (range.lo + range.hi) / 2, range.hi - 1].map(Math.round);
  return (
    <Chart
      title="Skin temperature"
      reading={skinTempReading(trace, props.cursor, props.clock)}
      plot={
        <Plot
          {...props}
          label={
            day
              ? `Skin temperature per minute, ${day.lo.toFixed(1)} to ${day.hi.toFixed(1)} °C`
              : "Skin temperature"
          }
          grid={[...new Set(ticks)].map((c) => ({ y: y(c), text: `${c}°` }))}
        >
          <path d={linePath(temp, y)} class="trace-line temp" />
        </Plot>
      }
    />
  );
}

function Chart(props: {
  title: string;
  reading: Reading;
  above?: ComponentChildren;
  plot: ComponentChildren;
}) {
  const { reading } = props;
  return (
    <section class="trace">
      <div class="trace-head">
        <h3 class="trace-title">{props.title}</h3>
        <span class="trace-value" style={reading.color ? { color: reading.color } : undefined}>
          {reading.value}
        </span>
        <span class="trace-unit muted">{reading.unit}</span>
      </div>
      {props.above}
      {props.plot}
      <p class="trace-note muted" aria-live="polite">
        {reading.note}
      </p>
    </section>
  );
}

interface Line {
  y: number;
  text: string;
  color?: string;
}

function Plot(
  props: ChartProps & {
    label: string;
    grid: Line[];
    dashed?: boolean;
    names?: Line[];
    children: ComponentChildren;
  },
) {
  const { trace, minutes, height } = props;
  const pct = (minute: number) => `${(minute / minutes) * 100}%`;
  const at = (ms: number) => (ms - trace.start) / 60_000;
  const now = at(trace.end);
  const every = props.isPhone ? 360 : 180;
  const hours = Array.from({ length: Math.floor(minutes / every) + 1 }, (_, i) => i * every);
  return (
    <>
      <div class="trace-plot" style={{ height: `${height}px` }} {...picking(props, now)}>
        <Shading trace={trace} pct={pct} />
        <svg
          viewBox={`0 0 ${minutes} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={props.label}
        >
          {hours.slice(1, -1).map((m) => (
            <line key={m} x1={m} x2={m} y1={0} y2={height} class="trace-grid" />
          ))}
          {props.grid.map((g) => (
            <line
              key={g.text}
              x1={0}
              x2={minutes}
              y1={g.y}
              y2={g.y}
              class={props.dashed ? "trace-grid zone" : "trace-grid"}
            />
          ))}
          {props.children}
        </svg>
        <Ticks grid={props.grid} names={props.names ?? []} height={height} />
        {now < minutes && <div class="trace-now" style={{ left: pct(now) }} />}
        {props.cursor !== null && (
          <div class="trace-cursor" style={{ left: pct(props.cursor + 0.5) }} />
        )}
      </div>
      <Hours {...props} hours={hours} pct={pct} />
    </>
  );
}

/** Sleep, workouts, walks and time not worn, behind the chart. */
function Shading(props: { trace: DayTraceView; pct: (minute: number) => string }) {
  const { trace, pct } = props;
  const at = (ms: number) => (ms - trace.start) / 60_000;
  return trace.spans.map((s) => (
    <div
      key={`${s.kind}${s.start}`}
      class={`trace-span ${s.kind === "notWorn" ? "not-worn" : s.kind}`}
      style={{ left: pct(at(s.start)), width: pct(at(s.end) - at(s.start)) }}
    />
  ));
}

/**
 * A mouse reads the minute it is over and lets go on leaving; a finger reads where it touches or
 * drags and the reading stays, since there is nothing to leave. The plot only takes sideways
 * drags (`touch-action: pan-y`), so the page still scrolls.
 */
function picking(props: ChartProps, now: number): JSX.HTMLAttributes<HTMLDivElement> {
  const pick = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    props.onPick(minuteAt(e.clientX - box.left, box.width, props.minutes, now));
  };
  return {
    onPointerDown: pick,
    onPointerMove: pick,
    onPointerLeave: (e) => {
      if (e.pointerType === "mouse") {
        props.onPick(null);
      }
    },
  };
}

/** The y labels inside the plot: values on the left, zone names on the right. */
function Ticks(props: { grid: Line[]; names: Line[]; height: number }) {
  const top = (y: number) => `${(y / props.height) * 100}%`;
  return (
    <>
      {props.grid.map((g) => (
        <span key={g.text} class="trace-tick" style={{ top: top(g.y) }} aria-hidden>
          {g.text}
        </span>
      ))}
      {props.names.map((n) => (
        <span
          key={n.text}
          class="trace-tick right"
          style={{ top: top(n.y), color: n.color }}
          aria-hidden
        >
          {n.text}
        </span>
      ))}
    </>
  );
}

/** The hours under a chart; the last is "24:00", not the next day's "00:00". */
function Hours(props: ChartProps & { hours: number[]; pct: (minute: number) => string }) {
  const { minutes, pct, hours } = props;
  return (
    <div class="trace-hours muted" aria-hidden>
      {hours.map((m, i) => (
        <span key={m} class={`trace-hour${edge(i, hours.length)}`} style={{ left: pct(m) }}>
          {m === minutes || m === 1440 ? "24:00" : props.clock.at(m)}
        </span>
      ))}
    </div>
  );
}

/** The first and last hour sit inside the chart's edges rather than centred on them. */
function edge(index: number, count: number): string {
  if (index === 0) {
    return " start";
  }
  return index === count - 1 ? " end" : "";
}

/** Sleep and each workout, named over the heart-rate chart; walks are only shaded. */
function SpanLabels(props: ChartProps) {
  const { trace, minutes, clock } = props;
  const at = (ms: number) => (ms - trace.start) / 60_000;
  const named = trace.spans.filter((s) => s.kind === "sleep" || s.kind === "workout");
  return (
    <div class="trace-labels muted" aria-hidden>
      {named.map((s) => (
        <span key={s.start} style={{ left: `${(at(s.start) / minutes) * 100}%` }}>
          {s.kind === "sleep" ? "Sleep" : capitalised(s.workoutKind)} {clock.at(at(s.start))}–
          {clock.at(at(s.end))}
        </span>
      ))}
    </div>
  );
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
