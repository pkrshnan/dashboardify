// The task list: a quick-add box, then Overdue, Today, This week, Later and Someday. Rows are
// the hit area; ticking a task completes it in the vault.

import { useState } from "preact/hooks";
import type { TaskGroup } from "../../src/home/types";

interface Props {
  groups: TaskGroup[];
  /** Tasks ticked in this session, shown done until the next refresh drops them. */
  done: Set<string>;
  onComplete: (id: string) => void;
  onAdd: (text: string) => Promise<string>;
}

export function TaskList({ groups, done, onComplete, onAdd }: Props) {
  return (
    <div class="tasks">
      <QuickAdd onAdd={onAdd} />
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

function QuickAdd({ onAdd }: { onAdd: Props["onAdd"] }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    const value = text.trim();
    if (value === "" || busy) {
      return;
    }
    setBusy(true);
    try {
      setNote(await onAdd(value));
      setText("");
    } catch {
      setNote("Couldn't add that. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form class="quick-add" onSubmit={submit}>
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <input
          type="text"
          aria-label="Add a task or reminder"
          placeholder="Call dentist Fri 10:00"
          enterKeyHint="done"
          value={text}
          disabled={busy}
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </form>
      {note && (
        <div class="quick-add-note" aria-live="polite">
          {note}
        </div>
      )}
    </>
  );
}
