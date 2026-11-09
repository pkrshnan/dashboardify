// Small controls shared by the Settings › Calendars screens.

import type { CalendarView } from "../api";
import { CATEGORY } from "../lib/colors";
import { CATEGORIES } from "./calendar-helpers";

export function CategoryPicker(props: {
  value: CalendarView["category"];
  label: string;
  onChange: (category: CalendarView["category"]) => void;
}) {
  return (
    <label class="category-picker">
      <span class="capture-dot" style={{ background: CATEGORY[props.value] }} />
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value as CalendarView["category"])}
      >
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** On is grey, not green: the design keeps green for health status. */
export function Switch(props: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      class={`switch${props.on ? " on" : ""}`}
      aria-checked={props.on}
      aria-label={props.label}
      onClick={() => props.onChange(!props.on)}
    >
      <span />
    </button>
  );
}

/** The app-specific password field, with how to make one and the server's refusal if any. */
export function PasswordField(props: {
  value: string;
  onInput: (value: string) => void;
  failed: string | null;
}) {
  return (
    <label class="setup-field">
      <span>App-specific password</span>
      <input
        type="password"
        placeholder="xxxx-xxxx-xxxx-xxxx"
        autoComplete="off"
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
      {props.failed && <span class="settings-note warn">{props.failed}</span>}
      <span class="settings-note">
        Make one at account.apple.com › Sign-In and Security › App-Specific Passwords. It's stored
        encrypted and never shown again.
      </span>
    </label>
  );
}
