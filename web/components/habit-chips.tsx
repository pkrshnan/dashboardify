// Today's habits as chips under the focus row (docs/habits.md#web): tap one to tick it, again
// to untick. A tick shows at once; the home view reloads after. Auto habits tick themselves, so
// their chips say what they're waiting for only by staying open.

import { useState } from "preact/hooks";
import type { HomeHabit } from "../../src/home/types";
import { markHabit, type Token } from "../api";
import { href } from "../lib/router";

export function HabitChips(props: {
  habits: HomeHabit[];
  token: Token;
  reload: () => Promise<void>;
}) {
  const [ticked, setTicked] = useState(new Map<string, boolean>());
  if (props.habits.length === 0) {
    return null;
  }
  const tick = async (habit: HomeHabit, done: boolean) => {
    setTicked((shown) => new Map(shown).set(habit.id, done));
    try {
      await markHabit(props.token, habit.id, habit.day, done);
      await props.reload();
    } finally {
      setTicked((shown) => {
        const next = new Map(shown);
        next.delete(habit.id);
        return next;
      });
    }
  };
  return (
    <section class="habit-chips" aria-label="Habits">
      <a class="habit-chips-head" href={href("/habits")}>
        Habits
      </a>
      {props.habits.map((habit) => {
        const done = ticked.get(habit.id) ?? habit.done;
        return (
          <button
            type="button"
            key={habit.id}
            class={`habit-chip${done ? " done" : ""}`}
            style={{ "--habit-color": habit.color || "var(--control)" }}
            aria-pressed={done}
            onClick={() => tick(habit, !done)}
          >
            <span class="habit-chip-dot" />
            {habit.name}
          </button>
        );
      })}
    </section>
  );
}
