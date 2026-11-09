// Settings › Calendars (the "Settings › Calendars" artboards): connect one iCloud account, choose
// how each calendar shows, and say where new events go. Changes save as you make them.

import { useCallback, useEffect, useState } from "preact/hooks";
import {
  type CalendarAccountView,
  type CalendarPreferencesView,
  type CalendarView,
  deleteCalendarAccount,
  getCalendarPreferences,
  listCalendarAccounts,
  listCalendars,
  replacePassword,
  syncCalendarAccount,
  Unauthorized,
  updateCalendar,
} from "../api";
import { calendarNote, statusLine } from "./calendar-helpers";
import { ConnectDialog } from "./connect-icloud";
import { CategoryPicker, PasswordField, Switch } from "./controls";
import { NewEvents } from "./new-events";
import type { SectionProps } from "./settings";

interface Loaded {
  account?: CalendarAccountView;
  calendars: CalendarView[];
  preferences: CalendarPreferencesView;
}

export function Calendars({ token, onUnauthorized }: SectionProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dialog, setDialog] = useState<"connect" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [account] = await listCalendarAccounts(token);
      const calendars = account ? await listCalendars(token, account.name) : [];
      setLoaded({ account, calendars, preferences: await getCalendarPreferences(token) });
    } catch (e) {
      if (e instanceof Unauthorized) {
        onUnauthorized(e.setup);
        return;
      }
      setError((e as Error).message);
    }
  }, [token, onUnauthorized]);
  useEffect(() => {
    load();
  }, [load]);
  if (!loaded) {
    return <p class="muted">{error ?? "Loading…"}</p>;
  }
  const done = () => {
    setDialog(null);
    load();
  };
  return (
    <div class="settings-pane">
      <h2>Calendars</h2>
      {loaded.account ? (
        <AccountSection
          token={token}
          loaded={loaded}
          onReplace={() => setDialog("password")}
          onChanged={load}
        />
      ) : (
        <NoAccount onConnect={() => setDialog("connect")} />
      )}
      {loaded.account && (
        <NewEvents token={token} calendars={loaded.calendars} preferences={loaded.preferences} />
      )}
      {dialog === "connect" && <ConnectDialog token={token} onClose={done} />}
      {dialog === "password" && loaded.account && (
        <PasswordDialog token={token} account={loaded.account} onClose={done} />
      )}
    </div>
  );
}

function NoAccount({ onConnect }: { onConnect: () => void }) {
  return (
    <section class="settings-group">
      <h3>iCloud</h3>
      <p class="settings-note">
        Connect your iCloud account to see your calendars here and add events from the capture box.
        You'll need an app-specific password from account.apple.com.
      </p>
      <button
        type="button"
        class="capture-add"
        style={{ alignSelf: "flex-start", marginTop: "12px" }}
        onClick={onConnect}
      >
        Connect iCloud
      </button>
    </section>
  );
}

function AccountSection(props: {
  token: SectionProps["token"];
  loaded: Loaded;
  onReplace: () => void;
  onChanged: () => Promise<void>;
}) {
  const { token, loaded, onChanged } = props;
  const account = loaded.account as CalendarAccountView;
  const status = statusLine(account);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    await action().catch(() => undefined);
    setBusy(false);
    await onChanged();
  };
  const disconnect = () => {
    if (
      confirm("Disconnect iCloud? Its events leave the home screen. Nothing is deleted in iCloud.")
    ) {
      run(() => deleteCalendarAccount(token, account.name));
    }
  };
  return (
    <section class="settings-group">
      <div class="account-head">
        <div class="account-main">
          <div>
            <span class="device-name">{account.displayName}</span>{" "}
            <span class="settings-note">{account.username}</span>
          </div>
          <span class={`settings-note${status.warn ? " warn" : ""}`}>{status.text}</span>
        </div>
        {account.status === "STATUS_AUTH_FAILED" ? (
          <button type="button" class="capture-add small" onClick={props.onReplace}>
            Replace password
          </button>
        ) : (
          <button
            type="button"
            class="pill-button small"
            disabled={busy}
            onClick={() => run(() => syncCalendarAccount(token, account.name))}
          >
            {busy ? "Syncing…" : "Sync now"}
          </button>
        )}
        <button type="button" class="device-revoke" onClick={disconnect}>
          Disconnect
        </button>
      </div>
      {loaded.calendars.map((c) => (
        <CalendarRow key={c.name} token={token} calendar={c} onChanged={onChanged} />
      ))}
    </section>
  );
}

function CalendarRow(props: {
  token: SectionProps["token"];
  calendar: CalendarView;
  onChanged: () => Promise<void>;
}) {
  const { token, calendar } = props;
  const change = (patch: Parameters<typeof updateCalendar>[2]) =>
    updateCalendar(token, calendar.name, patch).then(props.onChanged);
  return (
    <div class="calendar-row">
      <div class="calendar-name">
        <span class="ell" style={{ color: calendar.enabled ? undefined : "var(--text-3)" }}>
          {calendar.displayName}
        </span>
        <span class="settings-note">{calendarNote(calendar)}</span>
      </div>
      <CategoryPicker
        value={calendar.category}
        label={`Category for ${calendar.displayName}`}
        onChange={(category) => change({ category })}
      />
      <Switch
        on={calendar.enabled}
        label={`Show ${calendar.displayName}`}
        onChange={(enabled) => change({ enabled })}
      />
    </div>
  );
}

function PasswordDialog(props: {
  token: SectionProps["token"];
  account: CalendarAccountView;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await replacePassword(props.token, props.account.name, password.trim());
      props.onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div class="dialog-backdrop">
      <form class="dialog dialog-body" role="dialog" aria-modal="true" onSubmit={save}>
        <h2>Replace password</h2>
        <PasswordField value={password} onInput={setPassword} failed={error} />
        <div class="dialog-actions">
          <button type="button" class="pill-button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="capture-add" disabled={busy || !password.trim()}>
            {busy ? "Testing…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
