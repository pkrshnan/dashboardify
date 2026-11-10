// Settings › General: time zone, tasks inbox, where place searches look, and Tailscale sign-in.
// Changes save as you make them.

import { useEffect, useState } from "preact/hooks";
import { getSettings, type SettingsView, Unauthorized, updateSettings } from "../api";
import { PlacesNear } from "./places-near";
import { timeZones } from "./sections";
import type { SectionProps } from "./settings";

type Change = Parameters<typeof updateSettings>[1];

export function General({ token, onUnauthorized }: SectionProps) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [restart, setRestart] = useState<string | null>(null);
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  useEffect(() => {
    getSettings(token).then(setSettings, (e: Error) =>
      e instanceof Unauthorized
        ? onUnauthorized(e.setup)
        : setError({ field: "", message: e.message }),
    );
  }, [token, onUnauthorized]);
  if (!settings) {
    return <p class="muted">{error ? error.message : "Loading…"}</p>;
  }
  const save = async (field: string, change: Change) => {
    try {
      const before = settings.timeZone;
      const next = await updateSettings(token, change);
      setSettings(next);
      setError(null);
      if (next.restartRequired.includes("time_zone")) {
        setRestart(before);
      }
    } catch (e) {
      setError({ field, message: (e as Error).message });
    }
  };
  const errorFor = (field: string) => (error?.field === field ? error.message : undefined);
  return (
    <div class="settings-pane">
      <h2>General</h2>
      <TimeSection
        settings={settings}
        restart={restart}
        error={errorFor("time_zone")}
        save={save}
      />
      <TasksSection settings={settings} error={errorFor("tasks_inbox")} save={save} />
      <section class="settings-group">
        <h3>Places</h3>
        <Row label="Search near" id="places-near">
          <PlacesNear
            token={token}
            settings={settings}
            error={errorFor("places_near")}
            onSave={(placesNear) => save("places_near", { placesNear })}
          />
        </Row>
      </section>
      <TailnetSection settings={settings} error={errorFor("tailnet")} save={save} />
      <p class="settings-foot">Changes save as you make them.</p>
    </div>
  );
}

interface GroupProps {
  settings: SettingsView;
  error: string | undefined;
  save: (field: string, change: Change) => Promise<void>;
}

function TimeSection({ settings, restart, error, save }: GroupProps & { restart: string | null }) {
  const [typed, setTyped] = useState(settings.timeZone);
  const zones = timeZones();
  // Read from the field, not state: picking from the list fires input and change together.
  const commit = (value: string) => {
    if (value !== settings.timeZone && (zones.length === 0 || zones.includes(value))) {
      save("time_zone", { timeZone: value });
    }
  };
  return (
    <section class="settings-group">
      <h3>Time</h3>
      <Row label="Time zone" id="tz">
        <input
          id="tz"
          class="settings-input"
          list="time-zones"
          value={typed}
          placeholder="The server's own zone"
          onInput={(e) => setTyped(e.currentTarget.value)}
          onChange={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget.value)}
        />
        <datalist id="time-zones">
          {zones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        {restart !== null && (
          <span class="settings-note">
            Changed from {restart || "the server's zone"}. Restart the server to use it.
          </span>
        )}
        <ErrorNote error={error} />
      </Row>
    </section>
  );
}

function TasksSection({ settings, error, save }: GroupProps) {
  const [inbox, setInbox] = useState(settings.tasksInbox);
  const commit = (value: string) =>
    value !== settings.tasksInbox && save("tasks_inbox", { tasksInbox: value });
  return (
    <section class="settings-group">
      <h3>Tasks</h3>
      <Row label="Inbox note" id="inbox">
        <input
          id="inbox"
          class="settings-input"
          value={inbox}
          onInput={(e) => setInbox(e.currentTarget.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget.value)}
        />
        <span class="settings-note">Where new tasks and reminders go, relative to the vault.</span>
        <ErrorNote error={error} />
      </Row>
    </section>
  );
}

function TailnetSection({ settings, error, save }: GroupProps) {
  const [proxy, setProxy] = useState(settings.tailnet.proxy);
  const saveTailnet = (next: { proxy?: string; allowedLogins?: string[] }) =>
    save("tailnet", { tailnet: { proxy, allowedLogins: settings.tailnet.allowedLogins, ...next } });
  return (
    <section class="settings-group">
      <h3>Tailscale sign-in</h3>
      <Row label="Proxy address" id="proxy">
        <input
          id="proxy"
          class="settings-input"
          value={proxy}
          placeholder="An IP address, or gateway in Docker"
          onInput={(e) => setProxy(e.currentTarget.value)}
          onBlur={(e) => {
            const value = e.currentTarget.value;
            if (value !== settings.tailnet.proxy) {
              saveTailnet({ proxy: value });
            }
          }}
        />
        <ErrorNote error={error} />
      </Row>
      <Row label="Allowed logins" id="login">
        <LoginChips
          logins={settings.tailnet.allowedLogins}
          onChange={(allowedLogins) => saveTailnet({ allowedLogins })}
        />
      </Row>
    </section>
  );
}

/** Each login as a chip with ×, then a field to add one (Return or leaving it adds). */
function LoginChips(props: { logins: string[]; onChange: (logins: string[]) => Promise<void> }) {
  const { logins, onChange } = props;
  const [login, setLogin] = useState("");
  const add = () => {
    const value = login.trim();
    if (value && !logins.includes(value)) {
      onChange([...logins, value]).then(() => setLogin(""));
    }
  };
  return (
    <div class="settings-chips">
      {logins.map((l) => (
        <span key={l} class="settings-chip">
          {l}
          <button
            type="button"
            aria-label={`Remove ${l}`}
            onClick={() => onChange(logins.filter((x) => x !== l))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id="login"
        class="settings-input settings-chip-input"
        placeholder="Add a login"
        value={login}
        onInput={(e) => setLogin(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        onBlur={add}
      />
    </div>
  );
}

function Row({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: preact.ComponentChildren;
}) {
  return (
    <div class="settings-row">
      <label for={id}>{label}</label>
      <div class="settings-field">{children}</div>
    </div>
  );
}

function ErrorNote({ error }: { error: string | undefined }) {
  return error ? <span class="settings-note bad">{error}</span> : null;
}
