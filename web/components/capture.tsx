// One box for events and reminders (the Main artboard). As you type it highlights the time, the
// people and the place, says whether the line will be an event or a reminder and why, which
// calendar it goes on, and which real place "at …" was found as. Return adds it. Until a calendar is connected, Event is off and everything becomes
// a reminder.

import { useEffect, useRef, useState } from "preact/hooks";
import type { CaptureKind } from "../../src/capture/parse";
import type { CaptureHints } from "../../src/home/calendar";
import type { CaptureResult, Token } from "../api";
import {
  type BoxState,
  chosenPlace,
  nextCalendar,
  nextPlace,
  type Preview,
  preview,
  segments,
  switched,
  typed,
} from "../lib/capture";
import { alpha, CATEGORY, TEXT_2 } from "../lib/colors";
import { type PlaceResults, usePlaces } from "../lib/use-places";

/** A line just added, shown under the box with Undo. */
interface Added {
  key: string;
  title: string;
  when: string;
  where: string;
  /** The calendar's colour for events; undefined for reminders. */
  color?: string;
  result: CaptureResult;
}

interface Props {
  /** For looking up the line's place as it is typed. */
  token: Token;
  timeZone: string;
  /** Writable calendars and the guess's history, or null with no calendar connected. */
  hints: CaptureHints | null;
  /** On the phone the kind switch moves under the text, next to an Add button. */
  isPhone: boolean;
  /** Saves the line (the server parses it again) and returns what was made. */
  onAdd: (box: BoxState, shown: Preview, requestId: string) => Promise<CaptureResult>;
  onUndo: (result: CaptureResult) => Promise<void>;
  newRequestId: () => string;
}

const NO_CALENDAR_TIP = "Connect a calendar in Settings to add events.";

export function Capture(props: Props) {
  const { timeZone, hints, isPhone, onAdd, onUndo, newRequestId } = props;
  const [box, setBox] = useState<BoxState>({ text: "" });
  const input = useFocusKey("n");
  const place = useShownPlace(props.token, box, preview(box, { now: new Date(), timeZone, hints }));
  const shown = place.shown;
  const adding = useAdding({ onAdd, onUndo, newRequestId });
  const submit = (event?: Event) => {
    event?.preventDefault();
    if (shown?.parse.title) {
      adding.add(box, shown).then((ok) => ok && setBox({ text: "" }));
    }
  };
  const kind = shown?.parse.kind;
  const color = shown?.calendar ? CATEGORY[shown.calendar.category] : undefined;
  const pick = (k: CaptureKind) => setBox((s) => switched(s, k));
  const kindSwitch = (
    <KindSwitch kind={kind} reason={shown?.reason} eventsEnabled={hints !== null} onPick={pick} />
  );
  const cycle = () =>
    hints && shown?.calendar && setBox((s) => nextCalendar(s, hints, shown.calendar?.name ?? ""));
  return (
    <div class="capture-wrap">
      <form
        class={`capture${kind ? ` kind-${kind}` : ""}`}
        style={formStyle(color)}
        onSubmit={submit}
      >
        <div class="capture-row">
          <KindIcon kind={kind} color={color} />
          <Mirror
            text={box.text}
            shown={shown}
            color={color}
            input={input}
            busy={adding.busy}
            onInput={(text) => setBox((state) => typed(state, text))}
          />
          {!isPhone && kindSwitch}
        </div>
        {shown && (
          <PreviewLine shown={shown} busy={adding.busy} onCycle={cycle}>
            <PlaceLine {...place} onNext={() => setBox((s) => place.next(s))} />
          </PreviewLine>
        )}
        {isPhone && (
          <PhoneActions kindSwitch={kindSwitch} disabled={!shown?.parse.title || adding.busy} />
        )}
      </form>
      {adding.failed && <RetryNote onRetry={() => submit()} />}
      {adding.added.map((row) => (
        <AddedRow key={row.key} row={row} onUndo={() => adding.undo(row)} />
      ))}
    </div>
  );
}

/** The line's place, looked up as it is typed, and the preview with the match that will be saved. */
function useShownPlace(token: Token, box: BoxState, base: Preview | undefined) {
  const query = base?.parse.place;
  const results = usePlaces(token, query ?? "");
  const { place, index } = chosenPlace(box, query, results.places);
  return {
    query,
    results,
    index,
    shown: base && (place ? { ...base, place } : base),
    next: (s: BoxState) => nextPlace(s, query ?? "", index, results.places.length),
  };
}

/** "📍 Dishoom · 7 Boundary Street, Whitechapel", with the next match a click away. */
function PlaceLine(props: {
  query: string | undefined;
  results: PlaceResults;
  index: number;
  shown: Preview | undefined;
  onNext: () => void;
}) {
  const { results, index } = props;
  const place = props.shown?.place;
  if (!props.query) {
    return null;
  }
  if (!place) {
    const note = results.searching
      ? `Looking up ${props.query}…`
      : `${props.query} wasn't found on the map, so it's saved as typed.`;
    return <div class="capture-place muted">{note}</div>;
  }
  const count = results.places.length;
  return (
    <div class="capture-place">
      <PinIcon />
      <span class="ell capture-place-name">{place.displayName}</span>
      <span class="ell muted">{place.address}</span>
      {count > 1 && (
        <button type="button" class="link" title="Show the next match" onClick={props.onNext}>
          {(index % count) + 1} of {count}
        </button>
      )}
    </div>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" class="capture-pin">
      <path
        d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
      <circle cx="12" cy="10" r="2.2" fill="currentColor" />
    </svg>
  );
}

/** On the phone: the kind switch under the text, with an Add button. */
function PhoneActions(props: { kindSwitch: preact.ComponentChildren; disabled: boolean }) {
  return (
    <div class="capture-actions">
      {props.kindSwitch}
      <span class="capture-spacer" />
      <button type="submit" class="capture-add" disabled={props.disabled}>
        Add
      </button>
    </div>
  );
}

/** The box takes the calendar's colour while the line reads as an event. */
function formStyle(color: string | undefined) {
  return color
    ? { borderColor: alpha(color, 0.7), boxShadow: `0 0 0 3px ${alpha(color, 0.16)}` }
    : undefined;
}

function RetryNote({ onRetry }: { onRetry: () => void }) {
  return (
    <div class="capture-note bad" role="alert">
      Couldn't add that.
      <button type="button" class="link" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/** Sending a line, the last few added (for Undo), and whether the last try failed. */
function useAdding({
  onAdd,
  onUndo,
  newRequestId,
}: Pick<Props, "onAdd" | "onUndo" | "newRequestId">) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [added, setAdded] = useState<Added[]>([]);
  // Kept across a Retry, so a request that did reach the server isn't added twice.
  const requestId = useRef(newRequestId());

  const add = async (box: BoxState, shown: Preview): Promise<boolean> => {
    if (busy) {
      return false;
    }
    setBusy(true);
    try {
      const result = await onAdd(box, shown, requestId.current);
      const color =
        shown.calendar && result.kind === "event" ? CATEGORY[shown.calendar.category] : undefined;
      const row = {
        key: requestId.current,
        title: shown.parse.title,
        when: shown.when,
        where: shown.where,
        color,
        result,
      };
      setAdded((rows) => [row, ...rows].slice(0, 3));
      setFailed(false);
      requestId.current = newRequestId();
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const undo = async (row: Added) => {
    setAdded((rows) => rows.filter((r) => r.key !== row.key));
    await onUndo(row.result);
  };
  return { busy, failed, added, add, undo };
}

function AddedRow({ row, onUndo }: { row: Added; onUndo: () => void }) {
  const mark = row.color
    ? { background: row.color, borderColor: row.color, borderStyle: "solid", borderRadius: "3px" }
    : undefined;
  return (
    <div class="capture-added" aria-live="polite">
      <span class="capture-added-mark" style={mark} aria-hidden="true" />
      <span class="ell capture-added-title">{row.title}</span>
      <span class="muted-2">{row.when}</span>
      <span class="capture-spacer" />
      <span class="muted">{row.where}</span>
      <button type="button" class="link" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}

interface MirrorProps {
  text: string;
  shown: Preview | undefined;
  /** The calendar's colour while it reads as an event. */
  color: string | undefined;
  input: { current: HTMLInputElement | null };
  busy: boolean;
  onInput: (text: string) => void;
}

/** A transparent input over a copy of its text, so phrases can be highlighted as you type. */
function Mirror({ text, shown, color, input, busy, onInput }: MirrorProps) {
  return (
    <div class="capture-field">
      <div class="capture-mirror" aria-hidden="true">
        {segments(text, shown?.parse).map((run, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: runs have no identity beyond their order
          <span
            key={i}
            class={run.kind ? `mark-${run.kind}` : undefined}
            style={markStyle(run.kind, color)}
          >
            {run.text}
          </span>
        ))}
      </div>
      <input
        ref={input}
        type="text"
        aria-label="Add an event or reminder"
        placeholder="Lunch with Sam tomorrow 12:30–13:30, or Call dentist Fri 10:00"
        enterKeyHint="done"
        autocomplete="off"
        value={text}
        readOnly={busy}
        onInput={(e) => onInput(e.currentTarget.value)}
      />
    </div>
  );
}

/** Event phrases are filled with the calendar's colour; reminders keep the dashed outline. */
function markStyle(kind: "when" | "who" | "where" | undefined, color: string | undefined) {
  if (!(kind && color)) {
    return undefined;
  }
  if (kind === "who" || kind === "where") {
    return { textDecorationColor: color };
  }
  return { background: alpha(color, 0.32), boxShadow: `0 0 0 2px ${alpha(color, 0.32)}` };
}

function KindIcon({ kind, color }: { kind: CaptureKind | undefined; color?: string }) {
  if (kind === "event") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" class="capture-icon">
        <g fill="none" stroke={color ?? TEXT_2} stroke-width="2" stroke-linecap="round">
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </g>
      </svg>
    );
  }
  if (kind === "reminder") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" class="capture-icon">
        <circle
          cx="12"
          cy="12"
          r="8.5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-dasharray="3 3"
        />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" class="capture-icon">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  );
}

interface KindSwitchProps {
  kind: CaptureKind | undefined;
  reason: string | undefined;
  eventsEnabled: boolean;
  onPick: (kind: CaptureKind) => void;
}

function KindSwitch({ kind, reason, eventsEnabled, onPick }: KindSwitchProps) {
  const tip = (mine: CaptureKind, other: string) => (kind === mine ? reason : other);
  return (
    <fieldset class="capture-kind" aria-label="Kind">
      <button
        type="button"
        aria-pressed={kind === "event"}
        disabled={!eventsEnabled}
        title={eventsEnabled ? tip("event", "Make it a calendar event") : NO_CALENDAR_TIP}
        onClick={() => onPick("event")}
      >
        Event
      </button>
      <button
        type="button"
        aria-pressed={kind === "reminder"}
        title={tip("reminder", "Make it a reminder")}
        onClick={() => onPick("reminder")}
      >
        Reminder
      </button>
    </fieldset>
  );
}

function PreviewLine({
  shown,
  busy,
  onCycle,
  children,
}: {
  shown: Preview;
  busy: boolean;
  onCycle: () => void;
  /** The place line, for events at a place. */
  children?: preact.ComponentChildren;
}) {
  const title = shown.parse.title;
  const calendar = shown.calendar;
  return (
    <div class="capture-preview">
      <div class="capture-preview-main">
        <span class={`ell capture-title${title ? "" : " muted"}`}>{title || "Add what it is"}</span>
        <span class="ell">{shown.when}</span>
        <span class="capture-spacer" />
        {calendar ? (
          <button type="button" class="capture-calendar" title={calendar.reason} onClick={onCycle}>
            <span class="capture-dot" style={{ background: CATEGORY[calendar.category] }} />
            {calendar.displayName}
          </button>
        ) : (
          <span class="muted">{shown.where}</span>
        )}
        <span class="muted capture-hint">{busy ? hint(shown) : "Return to add"}</span>
      </div>
      {children}
      <div class="capture-reason">{shown.reason}</div>
    </div>
  );
}

function hint(shown: Preview): string {
  return shown.calendar ? "Saving to iCloud…" : "Adding…";
}

/** Focuses the input when `key` is pressed anywhere outside a text field. */
function useFocusKey(key: string) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable]");
      if (event.key === key && !(typing || event.metaKey || event.ctrlKey || event.altKey)) {
        event.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [key]);
  return ref;
}
