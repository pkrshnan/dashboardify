// Settings › Calendars › New events: the default calendar and keyword rules. Only calendars you
// can write to are offered.

import { useState } from "preact/hooks";
import {
  type CalendarPreferencesView,
  type CalendarView,
  type Token,
  updateCalendarPreferences,
} from "../api";
import { parseWords, writableChoices } from "./calendar-helpers";

interface Props {
  token: Token;
  calendars: CalendarView[];
  preferences: CalendarPreferencesView;
}

export function NewEvents({ token, calendars, preferences }: Props) {
  const [saved, setSaved] = useState(preferences);
  const [error, setError] = useState<string | null>(null);
  const choices = writableChoices(calendars);
  const save = (change: Partial<CalendarPreferencesView>) =>
    updateCalendarPreferences(token, change).then(
      (next) => {
        setSaved(next);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  const rules = saved.keywordRules;
  const setRule = (i: number, rule: { words: string[]; calendar: string }) =>
    save({
      keywordRules: rules.map((r, j) => (j === i ? rule : r)).filter((r) => r.words.length > 0),
    });
  return (
    <section class="settings-group">
      <h3>New events</h3>
      <p class="settings-note">
        The capture box first uses the calendar of past events with a similar title, then these
        rules, then the default. Only calendars you can write to are offered.
      </p>
      <div class="settings-row">
        <label for="default-calendar">Default calendar</label>
        <CalendarSelect
          id="default-calendar"
          choices={choices}
          value={saved.defaultCalendar}
          onChange={(defaultCalendar) => save({ defaultCalendar })}
        />
      </div>
      <div class="settings-row">
        <label for="new-rule">Rules</label>
        <Rules
          rules={rules}
          choices={choices}
          error={error}
          onRule={setRule}
          onAdd={(rule) => save({ keywordRules: [...rules, rule] })}
        />
      </div>
    </section>
  );
}

function CalendarSelect(props: {
  id?: string;
  choices: CalendarView[];
  value: string;
  onChange: (name: string) => void;
}) {
  return (
    <select
      id={props.id}
      class="settings-input"
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
    >
      {props.value === "" && <option value="">Choose a calendar</option>}
      {props.choices.map((c) => (
        <option key={c.name} value={c.name}>
          {c.displayName}
        </option>
      ))}
    </select>
  );
}

type Rule = { words: string[]; calendar: string };

function Rules(props: {
  rules: Rule[];
  choices: CalendarView[];
  error: string | null;
  onRule: (i: number, rule: Rule) => void;
  onAdd: (rule: Rule) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div class="settings-field">
      {props.rules.map((rule, i) => (
        <div key={`${rule.calendar}-${rule.words.join()}`} class="rule-row">
          <input
            class="settings-input"
            aria-label="Words"
            defaultValue={rule.words.join(", ")}
            onBlur={(e) => props.onRule(i, { ...rule, words: parseWords(e.currentTarget.value) })}
          />
          <span class="settings-note">→</span>
          <CalendarSelect
            choices={props.choices}
            value={rule.calendar}
            onChange={(calendar) => props.onRule(i, { ...rule, calendar })}
          />
        </div>
      ))}
      <input
        id="new-rule"
        class="settings-input rule-new"
        placeholder="Add a rule: words separated by commas"
        value={draft}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          const words = parseWords(e.currentTarget.value);
          if (e.key === "Enter" && words.length > 0 && props.choices[0]) {
            props.onAdd({ words, calendar: props.choices[0].name }).then(() => setDraft(""));
          }
        }}
      />
      {props.error && <span class="settings-note bad">{props.error}</span>}
    </div>
  );
}
