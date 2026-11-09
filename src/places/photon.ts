// Place search through Photon (photon.komoot.io), an OpenStreetMap geocoder that needs no key.
// The public server asks for fair use, so answers are cached for an hour and each request names
// this app. PHOTON_URL points it at a self-hosted server instead.

import { type LatLng, type Place, type PlaceSearch, PlacesUnavailable } from "./place";

export const PHOTON_URL = "https://photon.komoot.io";

const LIMIT = 5;
const TIMEOUT_MS = 5_000;
const CACHE_MS = 60 * 60_000;
const CACHE_SIZE = 200;

/** Countries that write the house number before the street. */
const NUMBER_FIRST = new Set(["AU", "CA", "GB", "IE", "IN", "NZ", "US", "ZA"]);

type Fetch = (request: Request) => Promise<Response>;

/** The parts of a Photon feature this reads. */
interface Feature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
}

export class Photon implements PlaceSearch {
  private readonly cache = new Map<string, { at: number; places: Place[] }>();

  constructor(
    private readonly baseUrl = PHOTON_URL,
    private readonly fetch: Fetch = (request) => globalThis.fetch(request),
    private readonly now: () => number = Date.now,
  ) {}

  async search(query: string, near?: LatLng): Promise<Place[]> {
    const q = query.trim();
    if (!q) {
      return [];
    }
    const key = JSON.stringify([q.toLowerCase(), near?.latitude, near?.longitude]);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_MS) {
      return hit.places;
    }
    const places = await this.request(q, near);
    this.cache.delete(key);
    this.cache.set(key, { at: this.now(), places });
    if (this.cache.size > CACHE_SIZE) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    return places;
  }

  private async request(q: string, near: LatLng | undefined): Promise<Place[]> {
    const url = new URL("/api/", this.baseUrl);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(LIMIT));
    if (near) {
      url.searchParams.set("lat", String(near.latitude));
      url.searchParams.set("lon", String(near.longitude));
    }
    let response: Response;
    try {
      response = await this.fetch(
        new Request(url, {
          headers: { "user-agent": "dashboardify (self-hosted)" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      );
    } catch {
      throw new PlacesUnavailable(`Couldn't reach ${url.host}.`);
    }
    if (!response.ok) {
      throw new PlacesUnavailable(`${url.host} answered ${response.status}.`);
    }
    const body = (await response.json()) as { features?: Feature[] };
    return (body.features ?? []).flatMap((f) => placeOf(f) ?? []);
  }
}

function placeOf(feature: Feature): Place | undefined {
  const [longitude, latitude] = feature.geometry?.coordinates ?? [];
  const p = feature.properties ?? {};
  const street = streetLine(p);
  const name = p.name ?? street;
  if (latitude === undefined || longitude === undefined || !name) {
    return undefined;
  }
  // The district tells apart two of a chain in one city ("Covent Garden", "Soho").
  const town = p.city ?? p.town ?? p.village ?? p.county;
  const parts = [street, p.district, town, p.country].filter(
    (part, i, all): part is string => !!part && part !== name && all.indexOf(part) === i,
  );
  return { name, address: parts.join(", "), latitude, longitude };
}

/** "7 Boundary Street" in the UK and US, "Kastanienallee 7" in Germany. */
function streetLine(p: Record<string, string | undefined>): string | undefined {
  if (!p.street) {
    return undefined;
  }
  if (!p.housenumber) {
    return p.street;
  }
  return NUMBER_FIRST.has(p.countrycode ?? "")
    ? `${p.housenumber} ${p.street}`
    : `${p.street} ${p.housenumber}`;
}
