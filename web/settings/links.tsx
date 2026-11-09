// Settings › Calendars › Calendar links: read-only calendars added by URL, such as a work
// calendar published as ICS. Only the link's host is ever shown; the URL itself is a secret.

import { useState } from "preact/hooks";
import {
  addCalendarLink,
  type CalendarAccountView,
  type CalendarView,
  deleteCalendarAccount,
  replaceLink,
  type Token,
  updateCalendar,
} from "../api";
import { CATEGORIES, statusLine } from "./calendar-helpers";
import { CategoryPicker, Switch } from "./controls";

export interface Link {
  account: CalendarAccountView;
  calendar?: CalendarView;
}

export function LinksSection(props: {
  token: Token;
  links: Link[];
  onChanged: () => Promise<void>;
}) {
  const [dialog, setDialog] = useState<{ replace?: CalendarAccountView } | null>(null);
  const close = () => {
    setDialog(null);
    props.onChanged();
  };
  return (
    <section class="settings-group">
      <div class="account-head">
        <div class="account-main">
          <span class="device-name">Calendar links</span>
          <span class="settings-note">
            Read-only calendars added by URL, like a work calendar published as ICS. Checked every
            15 minutes.
          </span>
        </div>
        <button type="button" class="capture-add small" onClick={() => setDialog({})}>
          + Add calendar link
        </button>
      </div>
      {props.links.map((link) => (
        <LinkRow
          key={link.account.name}
          token={props.token}
          link={link}
          onReplace={() => setDialog({ replace: link.account })}
          onChanged={props.onChanged}
        />
      ))}
      {dialog && <LinkDialog token={props.token} replace={dialog.replace} onClose={close} />}
    </section>
  );
}

function LinkRow(props: {
  token: Token;
  link: Link;
  onReplace: () => void;
  onChanged: () => Promise<void>;
}) {
  const { account, calendar } = props.link;
  const status =
    account.status === "STATUS_OK"
      ? { text: statusLine(account).text.replace("Synced", "Updated"), warn: false }
      : { text: account.statusDetail ?? statusLine(account).text, warn: true };
  const change = (patch: Parameters<typeof updateCalendar>[2]) =>
    calendar && updateCalendar(props.token, calendar.name, patch).then(props.onChanged);
  const remove = () => {
    if (confirm(`Remove ${account.displayName}? Its events leave the home screen.`)) {
      deleteCalendarAccount(props.token, account.name).then(props.onChanged);
    }
  };
  return (
    <div class="link-row">
      <div class="calendar-name link-name">
        <div>
          <span class="ell">{account.displayName}</span>{" "}
          <span class="settings-note">{account.feedHost}</span>
        </div>
        <span class={`settings-note${status.warn ? " warn" : ""}`}>
          {status.text}
          {status.warn && (
            <button type="button" class="link" onClick={props.onReplace}>
              Replace link
            </button>
          )}
        </span>
      </div>
      {calendar && (
        <CategoryPicker
          value={calendar.category}
          label={`Category for ${account.displayName}`}
          onChange={(category) => change({ category })}
        />
      )}
      {calendar && (
        <Switch
          on={calendar.enabled}
          label={`Show ${account.displayName}`}
          onChange={(enabled) => change({ enabled })}
        />
      )}
      <button
        type="button"
        class="link-remove"
        aria-label={`Remove ${account.displayName}`}
        onClick={remove}
      >
        ×
      </button>
    </div>
  );
}

type CheckedLink = {
  name: string;
  host: string;
  count: number;
  category: CalendarView["category"];
};

/** The dialog's steps: check the URL (or replace a broken one), then add it as named. */
function useLinkDialog(props: {
  token: Token;
  replace?: CalendarAccountView;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [checked, setChecked] = useState<CheckedLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = async (step: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    await step().catch((e: Error) => setError(e.message));
    setBusy(false);
  };
  const check = (e: Event) => {
    e.preventDefault();
    attempt(async () => {
      if (props.replace) {
        await replaceLink(props.token, props.replace.name, url.trim());
        props.onClose();
        return;
      }
      const { account, calendars, eventCount } = await addCalendarLink(
        props.token,
        { feedUrl: url.trim() },
        true,
      );
      const category = calendars[0]?.category ?? "personal";
      setChecked({
        name: account.displayName,
        host: account.feedHost ?? "",
        count: eventCount,
        category,
      });
    });
  };
  const add = () =>
    attempt(async () => {
      const { calendars } = await addCalendarLink(
        props.token,
        { feedUrl: url.trim(), displayName: checked?.name },
        false,
      );
      const [made] = calendars;
      if (made && checked && made.category !== checked.category) {
        await updateCalendar(props.token, made.name, { category: checked.category });
      }
      props.onClose();
    });
  return { url, setUrl, checked, setChecked, busy, error, check, add };
}

/** Add a link (paste, Check, then name and category), or replace a broken link's URL. */
function LinkDialog(props: { token: Token; replace?: CalendarAccountView; onClose: () => void }) {
  const d = useLinkDialog(props);
  return (
    <div class="dialog-backdrop">
      <form class="dialog dialog-body" role="dialog" aria-modal="true" onSubmit={d.check}>
        <h2>
          {props.replace
            ? `Replace the link for ${props.replace.displayName}`
            : "Add calendar link"}
        </h2>
        <span class="settings-note">
          A read-only calendar from a URL, such as Outlook's "Publish calendar" ICS link.
        </span>
        <label class="setup-field">
          <span>Link</span>
          <input
            type="url"
            placeholder="https://… or webcal://…"
            value={d.url}
            readOnly={d.busy || d.checked !== null}
            onInput={(e) => d.setUrl(e.currentTarget.value)}
          />
          {d.error && <span class="settings-note warn">{d.error}</span>}
          <span class="settings-note">
            Anyone with the link can read the calendar, so it's stored encrypted. Settings only
            shows its host.
          </span>
        </label>
        {d.checked && <Checked checked={d.checked} onChange={d.setChecked} />}
        <div class="dialog-actions">
          {d.busy && <span class="settings-note">Fetching the calendar…</span>}
          <button type="button" class="pill-button" onClick={props.onClose}>
            Cancel
          </button>
          {d.checked ? (
            <button
              type="button"
              class="capture-add"
              disabled={d.busy || !d.checked.name.trim()}
              onClick={d.add}
            >
              Add
            </button>
          ) : (
            <button type="submit" class="capture-add" disabled={d.busy || !d.url.trim()}>
              {props.replace ? "Save" : "Check"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Checked(props: {
  checked: { name: string; host: string; count: number; category: CalendarView["category"] };
  onChange: (checked: {
    name: string;
    host: string;
    count: number;
    category: CalendarView["category"];
  }) => void;
}) {
  const { checked } = props;
  return (
    <div class="link-checked">
      <span class="settings-note">
        Found {checked.count} event{checked.count === 1 ? "" : "s"} in the next 60 days ·{" "}
        {checked.host}
      </span>
      <label class="setup-field">
        <span>Name</span>
        <input
          type="text"
          value={checked.name}
          onInput={(e) => props.onChange({ ...checked, name: e.currentTarget.value })}
        />
      </label>
      <label class="setup-field">
        <span>Shows as</span>
        <select
          class="settings-input"
          value={checked.category}
          onChange={(e) =>
            props.onChange({
              ...checked,
              category: e.currentTarget.value as CalendarView["category"],
            })
          }
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <span class="settings-note">
        Read-only. Events from links can't be edited here and aren't offered for new events.
      </span>
    </div>
  );
}
