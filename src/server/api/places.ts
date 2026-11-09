// PlaceService: place search for event locations, nearest to Settings' places_near first.

import { mapsUrl, type Place, type PlaceSearch, PlacesUnavailable } from "../../places/place";
import type { GeneralSettings } from "../../settings/core";
import { ApiError, invalidArgument } from "./errors";

/** A Place as the API reads it. */
export interface PlaceInput {
  displayName?: string;
  address?: string;
  location?: { latitude?: number; longitude?: number };
}

export class PlacesService {
  constructor(
    private readonly places: PlaceSearch,
    private readonly general: Pick<GeneralSettings, "get">,
  ) {}

  searchPlaces = async (request: { query: string }) => {
    try {
      const found = await this.places.search(request.query, this.general.get().placesNear);
      return { places: found.map(placeView) };
    } catch (error) {
      if (error instanceof PlacesUnavailable) {
        throw new ApiError(503, `Place search is unavailable: ${error.message}`, "unavailable");
      }
      throw error;
    }
  };
}

export function placeView(place: Place) {
  return {
    displayName: place.name,
    address: place.address,
    location: { latitude: place.latitude, longitude: place.longitude },
    mapsUri: mapsUrl(place.name, place),
  };
}

/** A Place from a request, or undefined for an empty one. Coordinates must be on Earth. */
export function placeFromInput(input: PlaceInput | undefined, field: string): Place | undefined {
  const name = input?.displayName?.trim();
  if (!name) {
    return undefined;
  }
  const latitude = input?.location?.latitude ?? Number.NaN;
  const longitude = input?.location?.longitude ?? Number.NaN;
  if (!(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)) {
    invalidArgument(`${field}.location needs a latitude and longitude`);
  }
  return { name, address: input?.address?.trim() ?? "", latitude, longitude };
}
