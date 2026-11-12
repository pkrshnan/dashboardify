// The night view: a night's sleep stages as a hypnogram, from GET /v1/days/{date}/night. It heads
// the Health page's sleep section, and home's sleep rows link to it. Stages are estimated from
// the strap, so the view says so, and marks nights that look unusual.

import { useEffect, useState } from "preact/hooks";
import { fetchNight, type NightView, type Token, Unauthorized } from "../api";
import { duration } from "../lib/activity";
import { nowIn } from "../lib/clock";
import { addDays, dateSpan } from "../lib/format";
import { hourTicks, LANE_NAMES, LANES, STAGE_COLORS, stageTotals } from "../lib/night";

interface Props {
  token: Token;
  /** The day the night ends on, YYYY-MM-DD in the server's time zone. */
  date: string;
  today: string;
  timeZone: string;
  onStep: (date: string) => void;
  onUnauthorized: (setup: boolean) => void;
}

type Loaded = { date: string; night: NightView | null };

export function Night(props: Props) {
  const { token, date, onUnauthorized } = props;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    fetchNight(token, date).then(
      (night) => live && setLoaded({ date, night }),
      (err) => {
        if (err instanceof Unauthorized) {
          onUnauthorized(err.setup);
        }
        // A day without a night is a 404; any other failure reads the same here.
        if (live) {
          setLoaded({ date, night: null });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [token, date, onUnauthorized]);
  const clock = (ms: number) => nowIn(props.timeZone, new Date(ms)).time;
  const night = loaded?.date === date ? loaded.night : undefined;
  return (
    <div class="night">
      <h3 class="night-title">Night, {dateSpan(addDays(date, -1), date)}</h3>
      {night === undefined && <p class="muted">Loading…</p>}
      {night === null && <p class="muted">No night recorded.</p>}
      {night && <NightBody night={night} clock={clock} timeZone={props.timeZone} />}
      <div class="night-steps">
        <button type="button" class="link-button" onClick={() => props.onStep(addDays(date, -1))}>
          ‹ {dateSpan(addDays(date, -2), addDays(date, -1))}
        </button>
        {date < props.today && (
          <button type="button" class="link-button" onClick={() => props.onStep(addDays(date, 1))}>
            {dateSpan(date, addDays(date, 1))} ›
          </button>
        )}
      </div>
    </div>
  );
}

function NightBody(props: { night: NightView; clock: (ms: number) => string; timeZone: string }) {
  const { night, clock } = props;
  const totals = stageTotals(night);
  return (
    <>
      <p class="night-times">
        {clock(night.onset)}–{clock(night.wake)}
        <span class="muted">
          {" "}
          · {duration(night.asleepMin)} asleep · score {Math.round(night.sleepScore)}
        </span>
      </p>
      {night.stages.length > 0 && totals ? (
        <>
          <Hypnogram night={night} clock={clock} timeZone={props.timeZone} />
          <p class="night-totals">{totals}</p>
          <p class="night-note muted">
            Estimated
            {night.stagesPlausible === false && (
              <span title="These stages look unlike your usual nights"> · unusual night</span>
            )}
          </p>
        </>
      ) : (
        <p class="muted">No stages for this night.</p>
      )}
    </>
  );
}

const W = 600;
const LANE_H = 30;
const H = LANES.length * LANE_H;

/**
 * Each stage run as a bar in its lane, joined by faint steps. The SVG stretches to the page's
 * width, so the lane names and hours are HTML and stay readable on a phone.
 */
function Hypnogram(props: { night: NightView; clock: (ms: number) => string; timeZone: string }) {
  const { night, clock } = props;
  const start = night.bed;
  const span = Math.max(1, night.wake - start);
  const x = (ms: number) => ((ms - start) / span) * W;
  const lane = (stage: NightView["stages"][number]["stage"]) => LANES.indexOf(stage) * LANE_H;
  const ticks = hourTicks(start, night.wake, props.timeZone);
  return (
    <figure class="hypnogram">
      <div class="hyp-lanes muted" aria-hidden>
        {LANES.map((s) => (
          <span key={s}>{LANE_NAMES[s]}</span>
        ))}
      </div>
      <div class="hyp-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Sleep stages from ${clock(night.bed)} to ${clock(night.wake)}`}
        >
          {ticks.map((t) => (
            <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H} class="hyp-grid" />
          ))}
          <Steps night={night} x={x} lane={lane} />
          {night.stages.map((r) => (
            <rect
              key={r.start}
              x={x(r.start)}
              y={lane(r.stage) + 4}
              width={Math.max(1, x(r.end) - x(r.start))}
              height={LANE_H - 8}
              fill={STAGE_COLORS[r.stage]}
            />
          ))}
        </svg>
        <div class="hyp-hours muted" aria-hidden>
          {ticks.map((t) => (
            <span key={t} style={{ left: `${(x(t) / W) * 100}%` }}>
              {clock(t).slice(0, 2)}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}

/** A faint line from each run to the next, so the night reads as one path through the lanes. */
function Steps(props: {
  night: NightView;
  x: (ms: number) => number;
  lane: (stage: NightView["stages"][number]["stage"]) => number;
}) {
  const { stages } = props.night;
  return stages.slice(1).map((r, i) => {
    const before = stages[i];
    if (!before || before.stage === r.stage) {
      return null;
    }
    const at = props.x(r.start);
    return (
      <line
        key={r.start}
        x1={at}
        x2={at}
        y1={props.lane(before.stage) + LANE_H / 2}
        y2={props.lane(r.stage) + LANE_H / 2}
        class="hyp-step"
      />
    );
  });
}
