// The event panel: tap an event on the Day view to see it, then Edit or Delete. Repeating events
// and read-only calendars open read-only, with why. Saves and deletes send the etag, so a change
// made in Apple Calendar meanwhile is refused rather than overwritten.

import { useEffect, useState } from "preact/hooks";
import { deleteEvent, type EventDetail, getEvent, type Token, updateEvent } from "../api";
import {
  changeFrom,
  type EventForm,
  formFor,
  moveStart,
  readOnlyReason,
  whenLabel,
} from "../lib/event-edit";

type Step = "view" | "edit" | "delete";

interface Props {
  token: Token;
  /** "events/{id}". */
  name: string;
  timeZone: string;
  onClose: () => void;
  /** After a save or delete, to refresh the home screen. */
  onChanged: () => Promise<void>;
}

export function EventPanel({ token, name, timeZone, onClose, onChanged }: Props) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [step, setStep] = useState<Step>("view");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getEvent(token, name).then(setEvent, (err: Error) => setError(err.message));
  }, [token, name]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const done = async () => {
    onClose();
    await onChanged();
  };
  return (
    <div class="dialog-backdrop">
      <div class="dialog" role="dialog" aria-modal="true" aria-label={event?.title ?? "Event"}>
        {!event && (
          <div class="dialog-body">
            <span class="muted">{error ?? "Loading…"}</span>
          </div>
        )}
        {event && step === "view" && (
          <ViewStep event={event} timeZone={timeZone} onClose={onClose} onStep={setStep} />
        )}
        {event && step === "edit" && (
          <EditStep
            token={token}
            event={event}
            timeZone={timeZone}
            onCancel={() => setStep("view")}
            onSaved={done}
          />
        )}
        {event && step === "delete" && (
          <DeleteStep
            token={token}
            event={event}
            onCancel={() => setStep("view")}
            onDeleted={done}
          />
        )}
      </div>
    </div>
  );
}

function ViewStep(props: {
  event: EventDetail;
  timeZone: string;
  onClose: () => void;
  onStep: (step: Step) => void;
}) {
  const { event } = props;
  const reason = readOnlyReason(event);
  return (
    <div class="dialog-body">
      <h2>{event.title}</h2>
      <span class="event-when">{whenLabel(event, props.timeZone)}</span>
      {event.location && <span class="event-text">{event.location}</span>}
      {event.notes && <span class="event-text muted">{event.notes}</span>}
      {reason && <span class="settings-note">{reason}</span>}
      <div class="dialog-actions">
        {!reason && (
          <button type="button" class="device-revoke" onClick={() => props.onStep("delete")}>
            Delete
          </button>
        )}
        <span class="dialog-spacer" />
        <button type="button" class="pill-button" onClick={props.onClose}>
          Close
        </button>
        {!reason && (
          <button type="button" class="capture-add" onClick={() => props.onStep("edit")}>
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

function EditStep(props: {
  token: Token;
  event: EventDetail;
  timeZone: string;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { event, timeZone } = props;
  const [form, setForm] = useState<EventForm>(() => formFor(event, timeZone));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (field: keyof EventForm) => (e: { currentTarget: { value: string } }) =>
    setForm({ ...form, [field]: e.currentTarget.value });

  const save = async (e: Event) => {
    e.preventDefault();
    const result = changeFrom(event, form, timeZone);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    if (Object.keys(result.change).length === 0) {
      props.onCancel();
      return;
    }
    setBusy(true);
    try {
      await updateEvent(props.token, event, result.change);
      await props.onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form class="dialog-body" onSubmit={save}>
      <h2>Edit event</h2>
      <label class="setup-field">
        <span>Title</span>
        <input type="text" value={form.title} onInput={set("title")} />
      </label>
      {!event.allDay && (
        <div class="event-times">
          <label class="setup-field">
            <span>Starts</span>
            <input
              type="datetime-local"
              value={form.start}
              onInput={(e) => setForm(moveStart(form, e.currentTarget.value, timeZone))}
            />
          </label>
          <label class="setup-field">
            <span>Ends</span>
            <input type="datetime-local" value={form.end} onInput={set("end")} />
          </label>
        </div>
      )}
      <label class="setup-field">
        <span>Location</span>
        <input type="text" value={form.location} onInput={set("location")} />
      </label>
      <label class="setup-field">
        <span>Notes</span>
        <textarea rows={3} value={form.notes} onInput={set("notes")} />
      </label>
      {event.allDay && (
        <span class="settings-note">All-day dates can only be changed in Apple Calendar.</span>
      )}
      {error && <span class="settings-note bad">{error}</span>}
      <div class="dialog-actions">
        <button type="button" class="pill-button" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="submit" class="capture-add" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function DeleteStep(props: {
  token: Token;
  event: EventDetail;
  onCancel: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await deleteEvent(props.token, props.event.name, props.event.etag);
      await props.onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div class="dialog-body danger">
      <h2>Delete {props.event.title}?</h2>
      <span class="settings-note">It's removed from iCloud, so it goes from every device.</span>
      {error && <span class="settings-note bad">{error}</span>}
      <div class="dialog-actions">
        <button type="button" class="pill-button" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" class="device-revoke" disabled={busy} onClick={remove}>
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}
