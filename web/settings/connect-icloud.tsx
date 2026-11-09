// Connect iCloud: Apple ID and app-specific password, Test (which saves nothing), then the
// calendars found, each with a category and a Show switch, then Connect.

import { useState } from "preact/hooks";
import { type CalendarView, connectICloud, type Token, updateCalendar } from "../api";
import { calendarNote, changesAfterConnect } from "./calendar-helpers";
import { CategoryPicker, PasswordField, Switch } from "./controls";

export function ConnectDialog({ token, onClose }: { token: Token; onClose: () => void }) {
  const [login, setLogin] = useState({ username: "", password: "" });
  const [found, setFound] = useState<CalendarView[] | null>(null);
  const { busy, error, attempt } = useAttempt();
  const test = (e: Event) => {
    e.preventDefault();
    attempt(async () => setFound((await connectICloud(token, login, true)).calendars));
  };
  const connect = () =>
    attempt(async () => {
      const { calendars } = await connectICloud(token, login, false);
      for (const { name, change } of changesAfterConnect(found ?? [], calendars)) {
        await updateCalendar(token, name, change);
      }
      onClose();
    });
  return (
    <div class="dialog-backdrop">
      <div class="dialog" role="dialog" aria-modal="true">
        {found ? (
          <Found
            calendars={found}
            busy={busy}
            error={error}
            onChange={setFound}
            onBack={() => setFound(null)}
            onConnect={connect}
          />
        ) : (
          <Credentials
            login={login}
            busy={busy}
            error={error}
            onChange={setLogin}
            onSubmit={test}
            onCancel={onClose}
          />
        )}
      </div>
    </div>
  );
}

function Found(props: {
  calendars: CalendarView[];
  busy: boolean;
  error: string | null;
  onChange: (calendars: CalendarView[]) => void;
  onBack: () => void;
  onConnect: () => void;
}) {
  const { calendars, onChange } = props;
  const set = (i: number, patch: Partial<CalendarView>) =>
    onChange(calendars.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div class="dialog-body">
      <h2>Found {calendars.length} calendars</h2>
      {calendars.map((c, i) => (
        <div key={c.displayName} class="calendar-row">
          <div class="calendar-name">
            <span class="ell">{c.displayName}</span>
            <span class="settings-note">{calendarNote(c) || "You can add events"}</span>
          </div>
          <CategoryPicker
            value={c.category}
            label={`Category for ${c.displayName}`}
            onChange={(category) => set(i, { category })}
          />
          <Switch
            on={c.enabled}
            label={`Show ${c.displayName}`}
            onChange={(enabled) => set(i, { enabled })}
          />
        </div>
      ))}
      <p class="settings-note">Reminders lists are skipped. Reminders stay in your vault.</p>
      {props.error && <p class="settings-note warn">{props.error}</p>}
      <div class="dialog-actions">
        <button type="button" class="pill-button" onClick={props.onBack}>
          Back
        </button>
        <button type="button" class="capture-add" disabled={props.busy} onClick={props.onConnect}>
          {props.busy ? "Connecting…" : "Connect"}
        </button>
      </div>
    </div>
  );
}

function Credentials(props: {
  login: { username: string; password: string };
  busy: boolean;
  error: string | null;
  /** Takes an update, so typing in one field never overwrites the other. */
  onChange: (
    update: (login: { username: string; password: string }) => {
      username: string;
      password: string;
    },
  ) => void;
  onSubmit: (e: Event) => void;
  onCancel: () => void;
}) {
  const { login } = props;
  return (
    <form class="dialog-body" onSubmit={props.onSubmit}>
      <h2>Connect iCloud</h2>
      <label class="setup-field">
        <span>Apple ID</span>
        <input
          type="email"
          autoComplete="username"
          value={login.username}
          onInput={(e) => {
            const username = e.currentTarget.value;
            props.onChange((l) => ({ ...l, username }));
          }}
        />
      </label>
      <PasswordField
        value={login.password}
        onInput={(password) => props.onChange((l) => ({ ...l, password }))}
        failed={props.error}
      />
      <div class="dialog-actions">
        {props.busy && <span class="settings-note">Signing in and finding calendars…</span>}
        <button type="button" class="pill-button" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          class="capture-add"
          disabled={props.busy || !(login.username && login.password)}
        >
          {props.busy ? "Testing…" : "Continue"}
        </button>
      </div>
    </form>
  );
}

/** Runs one step at a time, keeping whether it is running and the server's refusal. */
function useAttempt() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = async (step: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  return { busy, error, attempt };
}
