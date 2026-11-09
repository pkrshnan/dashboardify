import { describe, expect, test } from "bun:test";
import { DISHOOM, FakePhoton } from "../../places/fake-photon";
import { useApi } from "./helpers";

let server: FakePhoton;
const NEAR = {
  displayName: "London",
  address: "United Kingdom",
  location: { latitude: 51.5074, longitude: -0.1278 },
};

describe("places API", () => {
  const api = useApi({ photon: () => server });

  test("search returns places with a Maps link", async () => {
    server = new FakePhoton();

    const { status, body } = await api.call("/v1/places:search?query=Dishoom");

    expect(status).toBe(200);
    expect(body.places).toEqual([
      {
        displayName: "Dishoom",
        address: "7 Boundary Street, London, United Kingdom",
        location: { latitude: DISHOOM.lat, longitude: DISHOOM.lon },
        mapsUri: "https://maps.apple.com/?q=Dishoom&ll=51.5245%2C-0.0773",
      },
    ]);
  });

  test("search looks near the place in Settings", async () => {
    server = new FakePhoton();
    await api.call("/v1/settings?updateMask=placesNear", "PATCH", { placesNear: NEAR });

    await api.call("/v1/places:search?query=Dishoom");

    expect(server.requests[0]?.searchParams.get("lat")).toBe("51.5074");
  });

  test("a blank query is refused", async () => {
    server = new FakePhoton();

    const { status } = await api.call("/v1/places:search?query=");

    expect(status).toBe(400);
  });

  test("Photon failing is unavailable", async () => {
    server = new FakePhoton();
    server.status = 502;

    const { status, body } = await api.call("/v1/places:search?query=Dishoom");

    expect(status).toBe(503);
    expect(body).toMatchObject({ code: "unavailable" });
  });
});

describe("places_near in Settings", () => {
  const api = useApi();

  test("is saved, shown with a Maps link, and cleared by an empty update", async () => {
    const set = await api.call("/v1/settings?updateMask=placesNear", "PATCH", { placesNear: NEAR });
    const read = await api.call("/v1/settings");
    const cleared = await api.call("/v1/settings?updateMask=placesNear", "PATCH", {});

    expect(set.status).toBe(200);
    expect(read.body.placesNear).toMatchObject({
      ...NEAR,
      mapsUri: expect.stringContaining("ll="),
    });
    expect(cleared.body.placesNear).toBeUndefined();
  });

  test("needs coordinates", async () => {
    const { status } = await api.call("/v1/settings?updateMask=placesNear", "PATCH", {
      placesNear: { displayName: "London", location: { latitude: 200, longitude: 0 } },
    });

    expect(status).toBe(400);
  });
});
