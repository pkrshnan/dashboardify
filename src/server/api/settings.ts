// SettingsService: the time zone, tasks inbox, tailnet sign-in and where place searches look
// first, from settings.db.

import type { GeneralSettings, SettingsChange, StoredSettings } from "../../settings/core";
import { ApiError, invalidArgument } from "./errors";
import { type PlaceInput, placeFromInput, placeView } from "./places";
import { requestedFields } from "./update-mask";

export interface SettingsInput {
  name?: string;
  timeZone?: string;
  tasksInbox?: string;
  tailnet?: { proxy?: string; allowedLogins?: string[] };
  placesNear?: PlaceInput;
  etag?: string;
}

const FIELDS = ["timeZone", "tasksInbox", "tailnet", "placesNear"];

/** Fields that apply only after a restart: the vault and schedulers take the zone at start. */
const RESTART_FIELDS = new Set(["timeZone"]);

export class SettingsService {
  constructor(private readonly general: GeneralSettings) {}

  getSettings = async () => this.view(this.general.get(), []);

  updateSettings = async (request: { settings: SettingsInput; updateMask?: string }) => {
    const input = request.settings;
    if (input.name && input.name !== "settings") {
      invalidArgument("settings.name must be settings");
    }
    const current = this.general.get();
    if (input.etag && input.etag !== etagOf(current)) {
      throw new ApiError(409, "Settings changed since you loaded them. Reload and try again.");
    }
    const fields = requestedFields(request, input, FIELDS);
    const updated = this.write(fields, input);
    const changed = fields.filter((field) => differs(field, current, updated));
    return this.view(
      updated,
      changed.filter((field) => RESTART_FIELDS.has(field)),
    );
  };

  private write(fields: string[], input: SettingsInput): StoredSettings {
    const change: SettingsChange = {};
    if (fields.includes("timeZone")) {
      change.timeZone = input.timeZone || undefined;
    }
    if (fields.includes("tasksInbox")) {
      change.tasksInbox = inboxPath(input.tasksInbox);
    }
    if (fields.includes("tailnet")) {
      change.tailnetProxy = input.tailnet?.proxy?.trim() || undefined;
      change.tailnetLogins = (input.tailnet?.allowedLogins ?? [])
        .map((l) => l.trim())
        .filter(Boolean);
    }
    if (fields.includes("placesNear")) {
      change.placesNear = placeFromInput(input.placesNear, "places_near");
    }
    try {
      return this.general.update(change);
    } catch (error) {
      invalidArgument(error instanceof Error ? error.message : String(error));
    }
  }

  private view(stored: StoredSettings, restartRequired: string[]) {
    return {
      name: "settings",
      timeZone: stored.timeZone ?? "",
      tasksInbox: stored.tasksInbox,
      tailnet: { proxy: stored.tailnetProxy ?? "", allowedLogins: stored.tailnetLogins },
      ...(stored.placesNear && { placesNear: placeView(stored.placesNear) }),
      updateTime: stored.updateTime,
      etag: etagOf(stored),
      restartRequired: restartRequired.map(snake),
    };
  }
}

/** A vault-relative .md path that can't climb out of the vault. */
function inboxPath(value: string | undefined): string {
  const inbox = value?.trim() ?? "";
  if (!inbox.endsWith(".md") || inbox.startsWith("/") || inbox.split("/").includes("..")) {
    invalidArgument("tasks_inbox must be a .md file inside the vault, such as Inbox.md");
  }
  return inbox;
}

function etagOf(settings: StoredSettings): string {
  return `"${settings.updateTime}"`;
}

function differs(field: string, before: StoredSettings, after: StoredSettings): boolean {
  if (field === "tailnet") {
    return (
      before.tailnetProxy !== after.tailnetProxy ||
      before.tailnetLogins.join(",") !== after.tailnetLogins.join(",")
    );
  }
  if (field === "placesNear") {
    return JSON.stringify(before.placesNear) !== JSON.stringify(after.placesNear);
  }
  return before[field as keyof StoredSettings] !== after[field as keyof StoredSettings];
}

function snake(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
