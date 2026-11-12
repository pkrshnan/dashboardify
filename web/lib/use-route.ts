// The current address, following the address bar, and the ways to change it. Going to another
// page adds a history entry, so Back returns; changing a page's state (Day or Week) replaces
// the entry, so Back doesn't step through every toggle.

import { useEffect, useRef, useState } from "preact/hooks";
import { type Address, formatAddress, parseAddress, upgradeHash } from "./router";

/** Goes to `hash`, as a new history entry unless `replace`. */
export function navigate(hash: string, options: { replace?: boolean } = {}): void {
  if (!options.replace) {
    window.location.hash = hash;
    return;
  }
  history.replaceState(null, "", hash);
  // replaceState doesn't fire hashchange; tell useRoute ourselves.
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Sets some of the current page's query values ("" removes one), replacing the entry. */
export function setQuery(change: Record<string, string>): void {
  const current = parseAddress(window.location.hash);
  navigate(formatAddress({ ...current, query: { ...current.query, ...change } }), {
    replace: true,
  });
}

/** The address now. An old hash ("#activity") is rewritten in place first. */
export function useRoute(): Address {
  const [address, setAddress] = useState(() => {
    upgradeInPlace();
    return parseAddress(window.location.hash);
  });
  const path = useRef(address.path);
  useEffect(() => {
    const onChange = () => {
      upgradeInPlace();
      const next = parseAddress(window.location.hash);
      // A new page starts at the top; a state change on the same page stays where it is.
      if (next.path !== path.current) {
        path.current = next.path;
        window.scrollTo(0, 0);
      }
      setAddress(next);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return address;
}

function upgradeInPlace(): void {
  const upgraded = upgradeHash(window.location.hash);
  if (upgraded) {
    history.replaceState(null, "", upgraded);
  }
}
