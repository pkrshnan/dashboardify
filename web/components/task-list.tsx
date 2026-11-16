// The task list: Overdue, Today, This week, Later and Someday. Rows are the hit area; ticking a
// task completes it in the vault. New tasks come from the capture box.

import type { TaskGroup } from "../../src/home/types";

interface Props {
  groups: TaskGroup[];
  /** Tasks ticked in this session, shown done until the next refresh drops them. */
  done: Set<string>;
  onComplete: (id: string) => void;
}

export function TaskList({ groups, done, onComplete }: Props) {
  return (
    <div class="tasks">
      {groups.map((g) => (
        <div key={g.name} class={`task-group ${g.name.toLowerCase().replace(" ", "-")}`}>
          <h3>{g.name}</h3>
          {g.tasks.map((t) => {
            const isDone = done.has(t.id);
            return (
              <label key={t.id} class={`task-row${isDone ? " done" : ""}`}>
                <input
                  type="checkbox"
                  class="ring"
                  checked={isDone}
                  disabled={isDone}
                  aria-label={`Mark ${t.text} done`}
                  onChange={() => onComplete(t.id)}
                />
                <span class="task-text ell">{t.text}</span>
                <span class={`task-meta${g.name === "Overdue" ? " late" : ""}`}>{t.meta}</span>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}
