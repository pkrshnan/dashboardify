// A habit's settings: its name, how often, what ticks it, and its colour (docs/habits.md#web).
// The same form adds a habit and edits one; Return or the button saves.

import { useState } from "preact/hooks";
import type { HabitInput } from "../api";
import {
  cadenceNote,
  defaultValue,
  type FactView,
  HABIT_COLORS,
  type HabitSchedule,
  type HabitView,
  type RuleParts,
  ruleParts,
  ruleText,
  type ScheduleKind,
  WEEKDAYS,
} from "../lib/habits";
import { PickMenu } from "./pick-menu";
import { Segmented } from "./segmented";

const NEW_SCHEDULE: HabitSchedule = { kind: "daily", times: 3, days: [1, 3, 5] };
const MAX_TIMES = 7;

export function HabitForm(props: {
  habit: HabitView | null;
  facts: FactView[];
  onSave: (input: HabitInput) => Promise<void>;
}) {
  const { habit, facts } = props;
  const [name, setName] = useState(habit?.displayName ?? "");
  const [schedule, setSchedule] = useState<HabitSchedule>(habit?.schedule ?? NEW_SCHEDULE);
  const [rule, setRule] = useState<RuleParts>(ruleParts(habit?.auto ?? "", facts));
  const [color, setColor] = useState(habit?.color ?? "");
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: Event) => {
    event.preventDefault();
    try {
      await props.onSave({
        displayName: name.trim(),
        schedule,
        auto: ruleText(rule, facts),
        color,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <form class="habit-form" onSubmit={submit}>
      <label class="habit-field">
        <span>Name</span>
        <input
          class="habit-input"
          value={name}
          placeholder="Stretch"
          onInput={(e) => setName(e.currentTarget.value)}
        />
      </label>
      <HowOften schedule={schedule} onChange={setSchedule} />
      <TicksFrom rule={rule} facts={facts} onChange={setRule} />
      <Colours color={color} onChange={setColor} />
      {error && <p class="habit-error">{error}</p>}
      <button type="submit" class="habit-save" disabled={name.trim() === ""}>
        {habit ? "Save" : "Add habit"}
      </button>
    </form>
  );
}

function HowOften(props: { schedule: HabitSchedule; onChange: (s: HabitSchedule) => void }) {
  const { schedule, onChange } = props;
  return (
    <div class="habit-field">
      <span>How often</span>
      <Segmented<ScheduleKind>
        label="How often"
        segments={[
          { value: "daily", label: "Every day" },
          { value: "weekly", label: "Weekly" },
          { value: "days", label: "Set days" },
        ]}
        value={schedule.kind}
        onChange={(kind) => onChange(withKind(schedule, kind))}
      />
      {schedule.kind === "weekly" && (
        <div class="habit-stepper">
          <button
            type="button"
            class="habit-step"
            aria-label="Fewer times a week"
            disabled={schedule.times <= 1}
            onClick={() => onChange({ ...schedule, times: schedule.times - 1 })}
          >
            −
          </button>
          <span>
            {schedule.times} {schedule.times === 1 ? "time" : "times"} a week
          </span>
          <button
            type="button"
            class="habit-step"
            aria-label="More times a week"
            disabled={schedule.times >= MAX_TIMES}
            onClick={() => onChange({ ...schedule, times: schedule.times + 1 })}
          >
            +
          </button>
        </div>
      )}
      {schedule.kind === "days" && <DayPicker schedule={schedule} onChange={onChange} />}
      <p class="habit-hint">{cadenceNote(schedule)}</p>
    </div>
  );
}

/** A daily habit has no days of its own yet; Set days starts from Monday, Wednesday, Friday. */
function withKind(schedule: HabitSchedule, kind: ScheduleKind): HabitSchedule {
  const days = schedule.days.length > 0 ? schedule.days : NEW_SCHEDULE.days;
  return { ...schedule, kind, days };
}

function DayPicker(props: { schedule: HabitSchedule; onChange: (s: HabitSchedule) => void }) {
  const { schedule } = props;
  const toggle = (day: number) => {
    const on = schedule.days.includes(day);
    const days = on ? schedule.days.filter((d) => d !== day) : [...schedule.days, day];
    if (days.length > 0) {
      props.onChange({ ...schedule, days: days.sort((a, b) => a - b) });
    }
  };
  return (
    <fieldset class="habit-days" aria-label="Days">
      {WEEKDAYS.map((label, i) => (
        <button
          type="button"
          class="habit-day"
          key={label}
          aria-label={label}
          aria-pressed={schedule.days.includes(i + 1)}
          onClick={() => toggle(i + 1)}
        >
          {label.charAt(0)}
        </button>
      ))}
    </fieldset>
  );
}

function TicksFrom(props: {
  rule: RuleParts;
  facts: FactView[];
  onChange: (rule: RuleParts) => void;
}) {
  const { rule, facts, onChange } = props;
  const fact = facts.find((f) => f.name === rule.fact);
  const pick = (name: string) => {
    const picked = facts.find((f) => f.name === name);
    onChange({ fact: name, value: picked ? defaultValue(picked) : "" });
  };
  return (
    <div class="habit-field">
      <span>Ticks itself from</span>
      <PickMenu
        wide
        label="Ticks itself from"
        value={rule.fact}
        choices={[
          { value: "", label: "Nothing, I tick it" },
          ...facts.map((f) => ({ value: f.name, label: f.label })),
        ]}
        onChange={pick}
      />
      {fact && (
        <label class="habit-rule">
          <span>{fact.kind === "time" ? "By" : "At least"}</span>
          <input
            class="habit-input"
            type={fact.kind === "time" ? "time" : "number"}
            value={rule.value}
            onInput={(e) => onChange({ ...rule, value: e.currentTarget.value })}
          />
        </label>
      )}
    </div>
  );
}

function Colours(props: { color: string; onChange: (color: string) => void }) {
  return (
    <fieldset class="habit-colours" aria-label="Colour">
      {HABIT_COLORS.map((c, i) => (
        <button
          type="button"
          class="habit-swatch"
          key={c}
          aria-label={`Colour ${i + 1}`}
          aria-pressed={props.color.toUpperCase() === c}
          style={{ "--swatch": c }}
          onClick={() => props.onChange(c)}
        />
      ))}
    </fieldset>
  );
}
