// Settings › General › Places: where place searches look first. Type a town, pick it from the
// list, and event locations near it come up before ones of the same name elsewhere.

import { useState } from "preact/hooks";
import type { PlaceView, SettingsView, Token } from "../api";
import { usePlaces } from "../lib/use-places";

export function PlacesNear(props: {
  token: Token;
  settings: SettingsView;
  error: string | undefined;
  onSave: (placesNear: PlaceView | undefined) => Promise<void>;
}) {
  const { settings, onSave } = props;
  const [query, setQuery] = useState("");
  const { places, error, searching } = usePlaces(props.token, query);
  const near = settings.placesNear;
  const pick = (place: PlaceView | undefined) => onSave(place).then(() => setQuery(""));
  return (
    <div class="settings-field">
      {near && (
        <div class="place-chosen">
          <a href={near.mapsUri} target="_blank" rel="noreferrer">
            {near.displayName}
          </a>
          {near.address && <span class="settings-note">{near.address}</span>}
          <button type="button" class="pill-button small" onClick={() => pick(undefined)}>
            Clear
          </button>
        </div>
      )}
      <input
        id="places-near"
        class="settings-input"
        value={query}
        placeholder={near ? "Search for another town" : "Search for your town or city"}
        autoComplete="off"
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      {places.length > 0 && (
        <ul class="place-results">
          {places.map((p) => (
            <li key={`${p.location.latitude},${p.location.longitude}`}>
              <button type="button" onClick={() => pick(p)}>
                <span>{p.displayName}</span>
                <span class="settings-note">{p.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <span class={`settings-note${props.error || error ? " bad" : ""}`}>
        {props.error ?? error ?? placesNote(searching, query, places.length)}
      </span>
    </div>
  );
}

function placesNote(searching: boolean, query: string, found: number): string {
  if (searching) {
    return "Searching…";
  }
  if (query.trim().length >= 2 && found === 0) {
    return "Nothing found. Try the town's name on its own.";
  }
  return "Event locations near here come first. Searches use OpenStreetMap through Photon.";
}
