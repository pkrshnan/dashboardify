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
  setListItemDone,
  type Token,
  Unauthorized,
} from "../api";
import { doneItems, leftLabel, openSections, withTicks } from "../lib/lists";
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
      <AddItems slug={list.slug} title={list.title} onAdded={changed} />
      {open.map((section) => (
        <div key={section.title} class="list-section">
          {section.title && <h3>{section.title}</h3>}
          {section.items.map((item) => (
            <ItemRow key={item.name} item={item} onTick={tick} />
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

/** The add box: Return adds what's typed (commas add several) and clears it. */
function AddItems(props: { slug: string; title: string; onAdded: () => Promise<void> }) {
  const { token, isPhone } = useApp();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: Event) => {
    event.preventDefault();
    if (text.trim() === "") {
      return;
    }
    try {
      await addListItems(token, props.slug, text);
      setText("");
      setError(null);
      await props.onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <form class="list-add" onSubmit={submit}>
      <input
        class="list-input"
        aria-label={`Add to ${props.title}`}
        placeholder={
          isPhone ? `Add to ${props.title}` : `Add to ${props.title}. Commas add several`
        }
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
      />
      {error && <p class="list-error">{error}</p>}
    </form>
  );
}

function ItemRow(props: {
  item: ListItemView;
  onTick: (item: ListItemView, done: boolean) => void;
}) {
  const { item, onTick } = props;
  return (
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
