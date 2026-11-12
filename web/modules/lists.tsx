// Lists, at `#/lists/<list>`: checklists kept as notes in the vault's Lists/ folder
// (docs/lists.md). Desktop shows the lists beside the open one; the phone shows the lists at
// `#/lists` and one list at `#/lists/<list>`. Ticks show at once and reach the vault in order.

import type { RefObject } from "preact";
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
import {
  doneItems,
  dropSections,
  edgeScroll,
  leftLabel,
  openSections,
  type Section,
  sectionAt,
  sectionTitles,
  stepSection,
  withMove,
  withTicks,
} from "../lib/lists";
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
  const root = useRef<HTMLElement>(null);
  // After a change, the index's counts move too.
  const changed = async () => {
    await load();
    props.onChanged();
  };
  const { ticked, tick } = useListTicks(token, changed);
  const { moving, move } = useMove(token, changed);
  const { drag, start } = useItemDrag(root, move);
  if (error) {
    return <p class="list-error">{error}</p>;
  }
  if (!list) {
    return null;
  }
  const ticks = withTicks(list, ticked);
  const shown = moving ? withMove(ticks, moving.name, moving.to) : ticks;
  const open = openSections(shown);
  const left = open.reduce((count, section) => count + section.items.length, 0);
  const done = doneItems(shown);
  const titles = sectionTitles(list);
  return (
    <section ref={root} class="list" aria-label={list.title}>
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
      {(drag ? dropSections(shown) : open).map((section) => (
        <OpenSection
          key={section.title}
          section={section}
          drag={drag}
          onTick={tick}
          grip={titles.length > 0 ? { titles, start, move, root } : undefined}
        />
      ))}
      {drag && <DragGhost drag={drag} />}
      {done.length > 0 && (
        <DoneItems slug={list.slug} items={done} onTick={tick} onCleared={changed} />
      )}
    </section>
  );
}

/** Moves to the vault. Each shows at once and lasts until the reload after it. */
function useMove(token: Token, changed: () => Promise<void>) {
  const [moving, setMoving] = useState<{ name: string; to: string } | null>(null);
  const move = async (item: ListItemView, to: string) => {
    setMoving({ name: item.name, to });
    try {
      await moveListItem(token, item.name, to);
      await changed();
    } finally {
      setMoving(null);
    }
  };
  return { moving, move };
}

/** A heading and its open items; while dragging, a place to drop, lit when the pointer is over. */
function OpenSection(props: {
  section: Section;
  drag: Drag | null;
  onTick: (item: ListItemView, done: boolean) => void;
  /** Absent when the list has no headings, so nowhere to move to. */
  grip?: {
    titles: string[];
    start: (event: PointerEvent, item: ListItemView, from: string) => void;
    move: (item: ListItemView, to: string) => void;
    root: RefObject<HTMLElement>;
  };
}) {
  const { section, drag, grip } = props;
  const empty = section.items.length === 0;
  const lit = drag !== null && drag.over === section.title && drag.over !== drag.from;
  const step = (item: ListItemView, by: -1 | 1) => {
    const to = grip && stepSection(grip.titles, section.title, by);
    if (grip && to != null) {
      grip.move(item, to);
      // The row is drawn again under its new heading; keep the keyboard on its handle.
      requestAnimationFrame(() => focusGrip(grip.root.current, item.name));
    }
  };
  return (
    <div data-section={section.title} class={`list-section${lit ? " drop" : ""}`}>
      {(section.title || empty) && <h3>{section.title || "No section"}</h3>}
      {empty && <div class="list-drop-space" />}
      {section.items.map((item) => (
        <ItemRow
          key={item.name}
          item={item}
          onTick={props.onTick}
          dragging={drag?.item.name === item.name}
          grip={
            grip && {
              onPointerDown: (event) => grip.start(event, item, section.title),
              onStep: (by) => step(item, by),
            }
          }
        />
      ))}
    </div>
  );
}

/** The dragged item's name, held beside the pointer. */
function DragGhost({ drag }: { drag: Drag }) {
  return (
    <div class="list-ghost" style={{ left: `${drag.x}px`, top: `${drag.y}px` }} aria-hidden="true">
      {drag.item.text}
    </div>
  );
}

function focusGrip(root: HTMLElement | null, name: string) {
  const grips = root?.querySelectorAll<HTMLElement>("[data-grip]") ?? [];
  [...grips].find((grip) => grip.dataset.grip === name)?.focus();
}

interface Drag {
  item: ListItemView;
  /** The section it started in, and the one under the pointer. */
  from: string;
  over: string | null;
  x: number;
  y: number;
}

/**
 * Dragging an item by its handle onto another section. The handle keeps the pointer, so a
 * finger can't scroll the page instead; near the window's top or bottom the page scrolls itself
 * to reach sections out of view.
 */
function useItemDrag(
  root: RefObject<HTMLElement>,
  onDrop: (item: ListItemView, section: string) => void,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const start = (event: PointerEvent, item: ListItemView, from: string) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    const origin = { x: event.clientX, y: event.clientY };
    let last = origin;
    let frame = 0;
    const show = () =>
      setDrag({ item, from, over: sectionUnder(root.current, last.y), x: last.x, y: last.y });
    const scroll = () => {
      const by = edgeScroll(last.y, window.innerHeight);
      if (by !== 0) {
        window.scrollBy(0, by);
        show();
      }
      frame = requestAnimationFrame(scroll);
    };
    follow(handle, {
      // A few pixels of wobble is still a tap.
      begins: (e) => Math.hypot(e.clientX - origin.x, e.clientY - origin.y) >= 4,
      began: () => {
        frame = requestAnimationFrame(scroll);
      },
      moved: (e) => {
        last = { x: e.clientX, y: e.clientY };
        show();
      },
      ended: (dropped) => {
        cancelAnimationFrame(frame);
        setDrag(null);
        const to = dropped ? sectionUnder(root.current, last.y) : null;
        if (to !== null && to !== from) {
          onDrop(item, to);
        }
      },
    });
  };
  return { drag, start };
}

/** Pointer moves on a handle that holds the pointer, until it's lifted or the browser cancels. */
function follow(
  handle: HTMLElement,
  on: {
    begins: (event: PointerEvent) => boolean;
    began: () => void;
    moved: (event: PointerEvent) => void;
    /** `dropped` is false for a tap or a cancel. */
    ended: (dropped: boolean) => void;
  },
) {
  let live = false;
  const move = (event: PointerEvent) => {
    if (!live && on.begins(event)) {
      live = true;
      on.began();
    }
    if (live) {
      on.moved(event);
    }
  };
  const end = (event: PointerEvent) => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    if (live) {
      on.ended(event.type === "pointerup");
    }
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

/** The section drawn at height `y`; each carries `data-section`. */
function sectionUnder(root: HTMLElement | null, y: number): string | null {
  const boxes = [...(root?.querySelectorAll<HTMLElement>("[data-section]") ?? [])];
  return sectionAt(
    boxes.map((box) => {
      const { top, bottom } = box.getBoundingClientRect();
      return { title: box.dataset.section ?? "", top, bottom };
    }),
    y,
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

// The menu's value for "New section": a heading can't hold a line break.
const NEW_SECTION = "\nnew";

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
          // biome-ignore lint/a11y/noAutofocus: picking "New section…" is asking to type its name.
          autoFocus
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

/** The section to add to: a pill that opens a small menu of the list's headings. */
function SectionPick(props: {
  sections: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const { open, setOpen, close, onKey } = useMenu(wrap);
  const choices = [
    { value: "", label: "No section" },
    ...props.sections.map((title) => ({ value: title, label: title })),
    { value: NEW_SECTION, label: "New section…" },
  ];
  const current = choices.find((choice) => choice.value === props.value);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keys reach the menu's items through it.
    <div class="list-pick" ref={wrap} onKeyDown={open ? onKey : undefined}>
      <button
        type="button"
        class="list-pick-button"
        aria-label="Section"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span class="ell">{props.value === NEW_SECTION ? "New section" : current?.label}</span>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>
      {open && (
        <div class="list-pick-menu" role="menu" aria-label="Sections">
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="menuitemradio"
              aria-checked={choice.value === props.value}
              class={choice.value === NEW_SECTION ? "list-pick-new" : undefined}
              onClick={() => {
                props.onChange(choice.value);
                // "New section…" hands the keyboard to the name box.
                close(choice.value !== NEW_SECTION);
              }}
            >
              <span class="ell">{choice.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A menu under a button, both inside `wrap`. Opening focuses the checked item; the arrow keys
 * move through the items; Escape closes it back to the button; Tab or a tap outside just closes.
 */
function useMenu(wrap: RefObject<HTMLElement>) {
  const [open, setOpen] = useState(false);
  const items = () => [
    ...(wrap.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? []),
  ];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) {
      wrap.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
    }
  };
  useEffect(() => {
    if (!open) {
      return;
    }
    const all = items();
    (all.find((item) => item.getAttribute("aria-checked") === "true") ?? all[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const onKey = (event: KeyboardEvent) => {
    const by = arrowStep(event.key);
    if (by !== 0) {
      event.preventDefault();
      const all = items();
      const at = all.indexOf(document.activeElement as HTMLElement);
      all[(at + by + all.length) % all.length]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.key === "Escape" && event.preventDefault();
      close(event.key === "Escape");
    }
  };
  return { open, setOpen, close, onKey };
}

function arrowStep(key: string): number {
  if (key === "ArrowDown") {
    return 1;
  }
  return key === "ArrowUp" ? -1 : 0;
}

/**
 * One item: a tap ticks it. Open items have a handle beside them: drag it to another section,
 * or focus it and press the arrow keys.
 */
function ItemRow(props: {
  item: ListItemView;
  onTick: (item: ListItemView, done: boolean) => void;
  dragging?: boolean;
  grip?: { onPointerDown: (event: PointerEvent) => void; onStep: (by: -1 | 1) => void };
}) {
  const { item, onTick, grip } = props;
  return (
    <div class={`list-row${props.dragging ? " dragging" : ""}`}>
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
      {grip && (
        <button
          type="button"
          class="list-grip"
          data-grip={item.name}
          aria-label={`Move ${item.text}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          onPointerDown={grip.onPointerDown}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              grip.onStep(event.key === "ArrowUp" ? -1 : 1);
            }
          }}
        >
          <svg viewBox="0 0 12 16" width="12" height="16" aria-hidden="true">
            <circle cx="4" cy="3" r="1.3" />
            <circle cx="8" cy="3" r="1.3" />
            <circle cx="4" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="4" cy="13" r="1.3" />
            <circle cx="8" cy="13" r="1.3" />
          </svg>
        </button>
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
