import { describe, expect, test } from "bun:test";
import { Photon } from "../../src/places/photon";
import { mapsUrl, PlacesUnavailable } from "../../src/places/place";
import { DISHOOM, FakePhoton } from "./fake-photon";

describe("Photon", () => {
  test("reads a name, an address and coordinates", async () => {
    const server = new FakePhoton();

    const places = await new Photon("https://photon.test", server.fetch).search("dishoom");

    expect(places).toEqual([
      {
        name: "Dishoom",
        address: "7 Boundary Street, London, United Kingdom",
        latitude: 51.5245,
        longitude: -0.0773,
      },
    ]);
  });

  test("adds the district, so two of a chain in one city differ", async () => {
    const server = new FakePhoton([{ ...DISHOOM, district: "Soho" }]);

    const [place] = await new Photon("https://photon.test", server.fetch).search("dishoom");

    expect(place?.address).toBe("7 Boundary Street, Soho, London, United Kingdom");
  });

  test("writes the street the local way, and names a bare address by its street", async () => {
    const server = new FakePhoton([
      {
        street: "Kastanienallee",
        housenumber: "7",
        city: "Berlin",
        countrycode: "DE",
        lat: 52.5,
        lon: 13.4,
      },
    ]);

    const [place] = await new Photon("https://photon.test", server.fetch).search("kastanien");

    expect(place).toMatchObject({ name: "Kastanienallee 7", address: "Berlin" });
  });

  test("asks near a place when given one", async () => {
    const server = new FakePhoton();

    await new Photon("https://photon.test", server.fetch).search("dishoom", {
      latitude: 51.5,
      longitude: -0.12,
    });

    expect(server.requests[0]?.searchParams.get("lat")).toBe("51.5");
    expect(server.requests[0]?.searchParams.get("lon")).toBe("-0.12");
    expect(server.requests[0]?.searchParams.get("limit")).toBe("5");
  });

  test("answers the same search from its cache for an hour", async () => {
    const server = new FakePhoton();
    let now = 0;
    const photon = new Photon("https://photon.test", server.fetch, () => now);

    await photon.search("Dishoom");
    await photon.search("dishoom ");
    now += 61 * 60_000;
    await photon.search("dishoom");

    expect(server.requests).toHaveLength(2);
  });

  test("a blank search asks nothing", async () => {
    const server = new FakePhoton();

    expect(await new Photon("https://photon.test", server.fetch).search("  ")).toEqual([]);
    expect(server.requests).toHaveLength(0);
  });

  test("an error or no answer is PlacesUnavailable", async () => {
    const server = new FakePhoton();
    server.status = 429;
    const down = () => Promise.reject(new TypeError("fetch failed"));

    await expect(new Photon("https://photon.test", server.fetch).search("x")).rejects.toThrow(
      new PlacesUnavailable("photon.test answered 429."),
    );
    await expect(new Photon("https://photon.test", down).search("x")).rejects.toBeInstanceOf(
      PlacesUnavailable,
    );
  });
});

describe("mapsUrl", () => {
  test("pins the coordinates, or searches for the text without them", () => {
    expect(mapsUrl("Dishoom", { latitude: DISHOOM.lat, longitude: DISHOOM.lon })).toBe(
      "https://maps.apple.com/?q=Dishoom&ll=51.5245%2C-0.0773",
    );
    expect(mapsUrl("Room 4B")).toBe("https://maps.apple.com/?q=Room+4B");
  });
});
