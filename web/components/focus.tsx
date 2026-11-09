// Focus: date and time, the day's sentence, four snapshot numbers, and the next event.

import type { HomeView, MetricTrend, NextEvent } from "../../src/home/types";
import type { Now } from "../lib/clock";
import { recoveryColor, TEXT, toneColor } from "../lib/colors";
import { longDate, startsIn } from "../lib/format";

const FOCUS_KEYS = ["recovery", "sleepScore", "hrv", "restingHr"];

export function Focus({ view, now }: { view: HomeView; now: Now }) {
  const numbers = FOCUS_KEYS.map((key) => view.health.find((m) => m.key === key)).filter(
    (m): m is MetricTrend => m !== undefined,
  );
  const nextIn = view.next ? minutesUntil(view.next, view, now) : 0;
  return (
    <section class="focus">
      <div class="focus-main">
        <header class="focus-date">
          <span>{longDate(view.date)}</span>
          <span>{now.time}</span>
          <a class="settings-gear" href="#settings" title="Settings">
            <span class="visually-hidden">Settings</span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </a>
        </header>
        <p class="sentence">{view.sentence}</p>
        <div class="numbers">
          {numbers.map((m) => (
            <FocusNumber key={m.key} metric={m} />
          ))}
        </div>
      </div>
      {view.next && <Next event={view.next} inMin={nextIn} />}
    </section>
  );
}

function FocusNumber({ metric }: { metric: MetricTrend }) {
  const color = metric.key === "recovery" && metric.raw !== null ? recoveryColor(metric.raw) : TEXT;
  return (
    <div>
      <div class="number-value" style={{ color }}>
        {metric.value ?? "–"}
        {metric.unit && metric.value && <span class="unit">{metric.unit}</span>}
      </div>
      <div class="number-name">
        <span>{metric.name}</span>
        {metric.delta && <span style={{ color: toneColor(metric.tone) }}>{metric.delta}</span>}
      </div>
    </div>
  );
}

function Next({ event, inMin }: { event: NextEvent; inMin: number }) {
  const detail = [event.start, startsIn(inMin), event.detail].filter((p) => p !== "").join(" · ");
  return (
    <aside class="next">
      <div class="next-label">{inMin <= 0 ? "Now" : "Next"}</div>
      <div class="next-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div class="next-title ell">{event.title}</div>
          <div class="next-detail ell">{detail}</div>
        </div>
        {event.url && (
          <a class="pill-button" href={event.url} target="_blank" rel="noreferrer">
            Join
          </a>
        )}
      </div>
    </aside>
  );
}

/** Recount "in N min" from the live clock, not the moment the data was fetched. */
function minutesUntil(event: NextEvent, view: HomeView, now: Now): number {
  const fetched = new Date(view.generatedAt).getTime();
  const elapsed = Math.floor((Date.now() - fetched) / 60_000);
  return now.date === view.date ? event.inMin - elapsed : event.inMin;
}
