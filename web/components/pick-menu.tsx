// A dropdown in the app's own style, in place of <select>, whose menu the browser draws in its
// own font and colours: a pill that opens a small menu with a tick beside the current choice.
// Opening focuses that choice; the arrow keys move; Escape closes back to the pill; Tab or a tap
// outside just closes.

import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export interface PickChoice {
  value: string;
  label: string;
  /** Set apart under a line, like Lists' "New section…". */
  apart?: boolean;
  /** Picking it hands the keyboard to something else, so the pill isn't focused again. */
  handsOff?: boolean;
}

export function PickMenu(props: {
  /** The pill's accessible name, such as "Section". */
  label: string;
  value: string;
  choices: PickChoice[];
  onChange: (value: string) => void;
  /** What the pill says, when not the current choice's label. */
  shown?: string;
  /** Fills its row, as a form field does. */
  wide?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const { open, setOpen, close, onKey } = useMenu(wrap);
  const current = props.choices.find((choice) => choice.value === props.value);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keys reach the menu's items through it.
    <div class={`pick${props.wide ? " wide" : ""}`} ref={wrap} onKeyDown={open ? onKey : undefined}>
      <button
        type="button"
        class="pick-button"
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span class="ell">{props.shown ?? current?.label}</span>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>
      {open && (
        <div class="pick-menu" role="menu" aria-label={props.label}>
          {props.choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="menuitemradio"
              aria-checked={choice.value === props.value}
              class={choice.apart ? "pick-apart" : undefined}
              onClick={() => {
                props.onChange(choice.value);
                close(!choice.handsOff);
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
