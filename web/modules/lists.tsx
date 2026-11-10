// Lists, at `#/lists/<list>`: checklists kept as notes in the vault's Lists/ folder
// (docs/lists.md). Desktop shows the lists beside the open one; the phone shows the lists at
// `#/lists` and one list at `#/lists/<list>`. Ticks show at once and reach the vault in order.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  addListItems,
  clearDoneItems,
  createList,
  fetchList,
  fetchLists,
  type ListItemView,
  type ListView,
  moveListItem,
  setListItemDone,
  type Token,
  Unauthorized,
} from "../api";
import { doneItems, leftLabel, openSections, sectionTitles, withTicks } from "../lib/lists";
import { href } from "../lib/router";
import { navigate } from "../lib/use-route";
import { useApp } from "./context";
import type { Module, PageProps } from "./types";

export const lists: Module = {
  id: "lists",
  title: "Lists",
  icon: "lists",
  path: "/lists/:list?",
  key: "l",
  nav: { group: 2, phone: "tab" },
  needsHome: false,
  view: ListsPage,
};

function ListsPage({ params }: PageProps) {
  const { isPhone } = useApp();
  const { all, reload } = useAllLists();
  const slug = params.list ?? (isPhone ? undefined : all?.[0]?.slug);
  if (isPhone) {
    return (
      <main class="lists phone">
        {slug ? (
          <ListScreen slug={slug} back onChanged={reload} />
        ) : (
          <ListIndex all={all} onCreated={reload} />
        )}
      </main>
    );
  }
  return (
    <main class="lists">
      <ListIndex all={all} current={slug} onCreated={reload} />
      {slug && <ListScreen key={slug} slug={slug} onChanged={reload} />}
    </main>
  );
}

/** Every list's title and what's left, reloaded after a change to one of them. */
function useAllLists() {
  const { token, onUnauthorized } = useApp();
  const [all, setAll] = useState<ListView[] | null>(null);
  const reload = useCallback(async () => {
    try {
      setAll(await fetchLists(token));
    } catch (error) {
      if (error instanceof Unauthorized) {
        onUnauthorized(error.setup);
      }
    }
  }, [token, onUnauthorized]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { all, reload };
}

function ListIndex(props: { all: ListView[] | null; current?: string; onCreated: () => void }) {
  const { all, current } = props;
  return (
    <nav class="list-index" aria-label="Lists">
      <h1>Lists</h1>
      {all?.length === 0 && <p class="muted">No lists yet.</p>}
      {all?.map((list) => (
        <a
          key={list.slug}
          href={href(`/lists/${list.slug}`)}
          aria-current={list.slug === current ? "page" : undefined}
        >
          <span class="ell">{list.title}</span>
          <span class="list-count">{list.openCount}</span>
        </a>
      ))}
      <NewList onCreated={props.onCreated} />
    </nav>
  );
}

/** "New list", then a name; Return makes the note and opens it. */
function NewList({ onCreated }: { onCreated: () => void }) {
  const { token } = useApp();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" class="list-new" onClick={() => setOpen(true)}>
        + New list
      </button>
    );
  }
  const submit = async (event: Event) => {
    event.preventDefault();
    const input = (event.currentTarget as HTMLFormElement).elements.namedItem("title");
    const title = (input as HTMLInputElement | null)?.value.trim() ?? "";
    try {
      const list = await createList(token, title);
      setOpen(false);
      onCreated();
      navigate(href(`/lists/${list.slug}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <form class="list-new-form" onSubmit={submit}>
      <input name="title" class="list-input" aria-label="New list's name" placeholder="Name" />
      {error && <p class="list-error">{error}</p>}
    </form>
  );
}

function ListScreen(props: { slug: string; back?: boolean; onChanged: () => void }) {
  const { token } = useApp();
  const { list, error, load } = useList(props.slug);
  // After a change, the index's counts move too.
  const changed = async () => {
    await load();
    props.onChanged();
  };
  const { ticked, tick } = useListTicks(token, changed);
  if (error) {
    return <p class="list-error">{error}</p>;
  }
  if (!list) {
    return null;
  }
  const shown = withTicks(list, ticked);
  const open = openSections(shown);
  const left = open.reduce((count, section) => count + section.items.length, 0);
  const done = doneItems(shown);
  const titles = sectionTitles(list);
  const move = async (item: ListItemView, section: string) => {
    await moveListItem(token, item.name, section);
    await changed();
  };
  return (
    <section class="list" aria-label={list.title}>
      {props.back && (
        <a class="list-back" href={href("/lists")}>
          ‹ Lists
        </a>
      )}
      <header class="list-head">
        <h2>{list.title}</h2>
        <span class="muted">{leftLabel(left)}</span>
        <span class="list-path">{list.path}</span>
      </header>
      <AddItems slug={list.slug} title={list.title} sections={titles} onAdded={changed} />
      {open.map((section) => (
        <div key={section.title} class="list-section">
          {section.title && <h3>{section.title}</h3>}
          {section.items.map((item) => (
            <ItemRow
              key={item.name}
              item={item}
              onTick={tick}
              section={section.title}
              sections={titles}
              onMove={move}
            />
          ))}
        </div>
      ))}
      {done.length > 0 && (
        <DoneItems slug={list.slug} items={done} onTick={tick} onCleared={changed} />
      )}
    </section>
  );
}

/** One list, loaded and reloaded. */
function useList(slug: string) {
  const { token, onUnauthorized } = useApp();
  const [list, setList] = useState<ListView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setList(await fetchList(token, slug));
      setError(null);
    } catch (err) {
      if (err instanceof Unauthorized) {
        onUnauthorized(err.setup);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token, slug, onUnauthorized]);
  useEffect(() => {
    load();
  }, [load]);
  return { list, error, load };
}

/**
 * Ticks sent to the vault. Each shows at once and lasts until the reload after it; an item's
 * ticks wait for the one before, so a quick tick and untick arrive in that order.
 */
function useListTicks(token: Token, load: () => Promise<void>) {
  const [ticked, setTicked] = useState(new Map<string, boolean>());
  const queue = useRef(new Map<string, Promise<void>>());
  const tick = (item: ListItemView, done: boolean) => {
    setTicked((t) => new Map(t).set(item.name, done));
    const send = () => setListItemDone(token, item.name, done).then(() => undefined);
    const next = (queue.current.get(item.name) ?? Promise.resolve())
      .then(send, send)
      .then(load, load)
      .then(() => {
        if (queue.current.get(item.name) === next) {
          queue.current.delete(item.name);
          setTicked((t) => withoutKey(t, item.name));
        }
      });
    queue.current.set(item.name, next);
  };
  return { ticked, tick };
}

function withoutKey(map: Map<string, boolean>, key: string): Map<string, boolean> {
  const left = new Map(map);
  left.delete(key);
  return left;
}

// Menu values for "New section" and "No section": a heading can't hold a line break.
const NEW_SECTION = "\nnew";
const NO_SECTION = "\nnone";

/** What's typed in the add box and where it goes; `submit` sends it. */
function useAddItems(slug: string, onAdded: () => Promise<void>, focusBox: () => void) {
  const { token } = useApp();
  const [text, setText] = useState("");
  const [section, setSection] = useState("");
  const [newSection, setNewSection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const target = section === NEW_SECTION ? newSection.trim() : section;
  const submit = async (event: Event) => {
    event.preventDefault();
    if (text.trim() === "") {
      // Return in the section's name: next, what goes in it.
      focusBox();
      return;
    }
    if (section === NEW_SECTION && target === "") {
      setError("Name the new section first.");
      return;
    }
    try {
      await addListItems(token, slug, text, target);
      setText("");
      setError(null);
      setSection(target);
      setNewSection("");
      await onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return { text, setText, section, setSection, newSection, setNewSection, target, error, submit };
}

/**
 * The add box: Return adds what's typed (commas add several) and clears it. Beside it, the
 * section to add to; a new one gets its heading with the first item.
 */
function AddItems(props: {
  slug: string;
  title: string;
  sections: string[];
  onAdded: () => Promise<void>;
}) {
  const { isPhone } = useApp();
  const box = useRef<HTMLInputElement>(null);
  const add = useAddItems(props.slug, props.onAdded, () => box.current?.focus());
  const { text, setText, section, setSection, newSection, setNewSection, target, error } = add;
  const into = target || props.title;
  return (
    <form class="list-add" onSubmit={add.submit}>
      <div class="list-add-row">
        <input
          ref={box}
          class="list-input"
          aria-label={`Add to ${props.title}`}
          placeholder={isPhone ? `Add to ${into}` : `Add to ${into}. Commas add several`}
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <SectionPick sections={props.sections} value={section} onChange={setSection} />
      </div>
      {section === NEW_SECTION && (
        <input
          class="list-input list-new-section"
          aria-label="New section's name"
          placeholder="New section's name, such as Produce"
          value={newSection}
          onInput={(e) => setNewSection(e.currentTarget.value)}
        />
      )}
      {error && <p class="list-error">{error}</p>}
      {/* With two boxes, Return submits only if the form has a submit button. */}
      <button type="submit" class="visually-hidden" tabIndex={-1}>
        Add
      </button>
    </form>
  );
}

function SectionPick(props: {
  sections: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      class="list-section-pick"
      aria-label="Section"
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
    >
      <option value="">No section</option>
      {props.sections.map((title) => (
        <option key={title} value={title}>
          {title}
        </option>
      ))}
      <option value={NEW_SECTION}>New section…</option>
    </select>
  );
}

/** One item: a tap ticks it. Open items have a menu beside them to move to another section. */
function ItemRow(props: {
  item: ListItemView;
  onTick: (item: ListItemView, done: boolean) => void;
  /** The heading it's drawn under, "" for none, and the others it can move to. */
  section?: string;
  sections?: string[];
  onMove?: (item: ListItemView, section: string) => void;
}) {
  const { item, onTick, section, sections, onMove } = props;
  const others = ["", ...(sections ?? [])].filter((title) => title !== section);
  return (
    <div class="list-row">
      <button
        type="button"
        class={`list-item${item.done ? " done" : ""}`}
        aria-pressed={item.done}
        onClick={() => onTick(item, !item.done)}
      >
        <span class="ring" aria-hidden="true" />
        <span class="list-text">{item.text}</span>
        {item.note && <span class="list-note">{item.note}</span>}
      </button>
      {onMove && others.length > 0 && (
        <label class="list-move">
          <span aria-hidden="true">⋯</span>
          <select
            aria-label={`Move ${item.text}`}
            value=""
            onChange={(e) => {
              const value = e.currentTarget.value;
              onMove(item, value === NO_SECTION ? "" : value);
            }}
          >
            <option value="" disabled>
              Move to…
            </option>
            {others.map((title) => (
              <option key={title} value={title || NO_SECTION}>
                {title || "No section"}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function DoneItems(props: {
  slug: string;
  items: ListItemView[];
  onTick: (item: ListItemView, done: boolean) => void;
  onCleared: () => Promise<void>;
}) {
  const { token } = useApp();
  const clear = async () => {
    await clearDoneItems(token, props.slug);
    await props.onCleared();
  };
  return (
    <div class="list-done">
      <div class="list-done-head">
        <span class="muted">Done · {props.items.length}</span>
        <button type="button" class="list-clear" onClick={clear}>
          Clear done items
        </button>
      </div>
      {props.items.map((item) => (
        <ItemRow key={item.name} item={item} onTick={props.onTick} />
      ))}
    </div>
  );
}
