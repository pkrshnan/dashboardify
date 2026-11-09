// A real place: what an event's location points at. Shared by the server and the web app.

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Place extends LatLng {
  /** "Dishoom". */
  name: string;
  /** "7 Boundary Street, London, United Kingdom", or "" when the name is the whole address. */
  address: string;
}

/** Looks places up by what someone typed, nearest to `near` first when it is given. */
export interface PlaceSearch {
  search(query: string, near?: LatLng): Promise<Place[]>;
}

/** The places server couldn't be reached or answered with an error. */
export class PlacesUnavailable extends Error {}

/** An Apple Maps link: a pin at the coordinates when there are some, else a search for the text. */
export function mapsUrl(name: string, at?: LatLng): string {
  const url = new URL("https://maps.apple.com/");
  url.searchParams.set("q", name);
  if (at) {
    url.searchParams.set("ll", `${at.latitude},${at.longitude}`);
  }
  return url.href;
}
