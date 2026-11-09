// Place search as you type: waits for a pause, and drops answers to anything but the latest text.

import { useEffect, useState } from "preact/hooks";
import { type PlaceView, searchPlaces, type Token } from "../api";

const PAUSE_MS = 300;

export interface PlaceResults {
  places: PlaceView[];
  /** The search failed, e.g. Photon is down. */
  error: string | null;
  searching: boolean;
}

export function usePlaces(token: Token, query: string): PlaceResults {
  const [results, setResults] = useState<PlaceResults>({
    places: [],
    error: null,
    searching: false,
  });
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults({ places: [], error: null, searching: false });
      return;
    }
    let current = true;
    setResults((r) => ({ ...r, searching: true }));
    const timer = setTimeout(() => {
      searchPlaces(token, text).then(
        (places) => current && setResults({ places, error: null, searching: false }),
        (e: Error) => current && setResults({ places: [], error: e.message, searching: false }),
      );
    }, PAUSE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [token, query]);
  return results;
}
