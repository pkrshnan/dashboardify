// One box for events and reminders (the Main artboard). As you type it highlights the time and
// the people, says whether the line will be an event or a reminder and why, and Return adds it.
// Until a calendar is connected, Event is shown but off and everything becomes a reminder.

import { useEffect, useRef, useState } from "preact/hooks";
import type { CaptureKind, CaptureParse } from "../../src/capture/parse";
import { type BoxState, type Preview, preview, segments, switched, typed } from "../lib/capture";

/** A line just added, shown under the box with Undo. */
interface Added {
  key: string;
  title: string;
  when: string;
  where: string;
  /** "tasks/{id}" */
  name: string;
}

interface Props {
  timeZone: string;
  /** On the phone the kind switch moves under the text, next to an Add button. */
  isPhone: boolean;
  /** Saves the parsed line and returns the new task's name. */
  onAdd: (parse: CaptureParse, requestId: string) => Promise<string>;
  onUndo: (name: string) => Promise<void>;
  newRequestId: () => string;
}

const NO_CALENDAR_TIP = "Connect a calendar in Settings to add events.";

export function Capture({ timeZone, isPhone, onAdd, onUndo, newRequestId }: Props) {
  const [box, setBox] = useState<BoxState>({ text: "" });
  const input = useFocusKey("n");
  const shown = preview(box, { now: new Date(), timeZone, eventsEnabled: false });
  const adding = useAdding({ onAdd, onUndo, newRequestId });
  const submit = (event?: Event) => {
    event?.preventDefault();
    if (shown?.parse.title) {
      adding.add(shown).then((ok) => ok && setBox({ text: "" }));
    }
  };
  const kind = shown?.parse.kind;
  const kindSwitch = (
    <KindSwitch kind={kind} reason={shown?.reason} onPick={(k) => setBox((s) => switched(s, k))} />
  );
  return (
    <div class="capture-wrap">
      <form class={`capture${kind ? ` kind-${kind}` : ""}`} onSubmit={submit}>
        <div class="capture-row">
          <KindIcon kind={kind} />
          <Mirror
            text={box.text}
            shown={shown}
            input={input}
            busy={adding.busy}
            onInput={(text) => setBox((state) => typed(state, text))}
          />
          {!isPhone && kindSwitch}
        </div>
        {shown && <PreviewLine shown={shown} busy={adding.busy} />}
        {isPhone && (
          <div class="capture-actions">
            {kindSwitch}
            <span class="capture-spacer" />
            <button type="submit" class="capture-add" disabled={!shown?.parse.title || adding.busy}>
              Add
            </button>
          </div>
        )}
      </form>
      {adding.failed && (
        <div class="capture-note bad" role="alert">
          Couldn't add that.
          <button type="button" class="link" onClick={() => submit()}>
            Retry
          </button>
        </div>
      )}
      {adding.added.map((row) => (
        <AddedRow key={row.key} row={row} onUndo={() => adding.undo(row)} />
      ))}
    </div>
  );
}

/** Sending a line, the last few added (for Undo), and whether the last try failed. */
function useAdding({ onAdd, onUndo, newRequestId }: Omit<Props, "timeZone" | "isPhone">) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [added, setAdded] = useState<Added[]>([]);
  // Kept across a Retry, so a request that did reach the server isn't added twice.
  const requestId = useRef(newRequestId());

  const add = async (shown: Preview): Promise<boolean> => {
    if (busy) {
      return false;
    }
    setBusy(true);
    try {
      const name = await onAdd(shown.parse, requestId.current);
      const row = {
        key: requestId.current,
        title: shown.parse.title,
        when: shown.when,
        where: shown.where,
        name,
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
    await onUndo(row.name);
  };
  return { busy, failed, added, add, undo };
}

function AddedRow({ row, onUndo }: { row: Added; onUndo: () => void }) {
  return (
    <div class="capture-added" aria-live="polite">
      <span class="capture-added-mark" aria-hidden="true" />
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
  input: { current: HTMLInputElement | null };
  busy: boolean;
  onInput: (text: string) => void;
}

/** A transparent input over a copy of its text, so phrases can be highlighted as you type. */
function Mirror({ text, shown, input, busy, onInput }: MirrorProps) {
  return (
    <div class="capture-field">
      <div class="capture-mirror" aria-hidden="true">
        {segments(text, shown?.parse).map((run, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: runs have no identity beyond their order
          <span key={i} class={run.kind ? `mark-${run.kind}` : undefined}>
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

function KindIcon({ kind }: { kind: CaptureKind | undefined }) {
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
  onPick: (kind: CaptureKind) => void;
}

function KindSwitch({ kind, reason, onPick }: KindSwitchProps) {
  return (
    <fieldset class="capture-kind" aria-label="Kind">
      <button type="button" aria-pressed={kind === "event"} disabled title={NO_CALENDAR_TIP}>
        Event
      </button>
      <button
        type="button"
        aria-pressed={kind === "reminder"}
        title={kind === "reminder" ? reason : "Make it a reminder"}
        onClick={() => onPick("reminder")}
      >
        Reminder
      </button>
    </fieldset>
  );
}

function PreviewLine({ shown, busy }: { shown: Preview; busy: boolean }) {
  const title = shown.parse.title;
  return (
    <div class="capture-preview">
      <div class="capture-preview-main">
        <span class={`ell capture-title${title ? "" : " muted"}`}>{title || "Add what it is"}</span>
        <span class="ell">{shown.when}</span>
        <span class="capture-spacer" />
        <span class="muted">{shown.where}</span>
        <span class="muted capture-hint">{busy ? "Adding…" : "Return to add"}</span>
      </div>
      <div class="capture-reason">{shown.reason}</div>
    </div>
  );
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
