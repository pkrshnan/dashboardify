// A Photon server in memory: answers /api/?q= from a fixed list of GeoJSON features, and
// remembers the requests it was sent.

export interface FakeFeature {
  name?: string;
  street?: string;
  housenumber?: string;
  district?: string;
  city?: string;
  country?: string;
  countrycode?: string;
  lat: number;
  lon: number;
}

export const DISHOOM: FakeFeature = {
  name: "Dishoom",
  street: "Boundary Street",
  housenumber: "7",
  city: "London",
  country: "United Kingdom",
  countrycode: "GB",
  lat: 51.5245,
  lon: -0.0773,
};

export class FakePhoton {
  readonly requests: URL[] = [];
  status = 200;

  constructor(private readonly features: FakeFeature[] = [DISHOOM]) {}

  fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    this.requests.push(url);
    if (this.status !== 200) {
      return new Response("busy", { status: this.status });
    }
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const matches = this.features.filter((f) =>
      [f.name, f.street].some((text) => text?.toLowerCase().includes(q)),
    );
    return Response.json({
      type: "FeatureCollection",
      features: matches.map(({ lat, lon, ...properties }) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties,
      })),
    });
  };
}
