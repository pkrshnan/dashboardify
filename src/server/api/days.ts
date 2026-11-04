import { defined } from "../../defined";
import type { Frontmatter } from "../../vault/markdown";
import { editNote } from "../../vault/markdown";
import { shortHash } from "../../vault/task-store";
import { isIsoDate } from "../../vault/time";
import type { Vault } from "../../vault/vault";
import { ApiError, invalidArgument } from "./errors";
import type { ApiRequests, CheckinInput } from "./requests";
import { requestedFields } from "./update-mask";

/** Reads daily notes and updates check-in frontmatter under the vault lock. */
export class DaysService {
  constructor(private readonly vault: Vault) {}

  private readonly dayOf = (name: string) => {
    const match = /^days\/(\d{4}-\d{2}-\d{2})(?:\/checkin)?$/.exec(name ?? "");
    if (!(match && isIsoDate(match[1]))) {
      invalidArgument("invalid day name");
    }
    return defined(match?.[1]);
  };

  private readonly checkin = async (day: string) => {
    const frontmatter = (await this.vault.readDaily(day))?.frontmatter ?? {};
    return {
      name: `days/${day}/checkin`,
      feel: frontmatter.feel,
      rpe: frontmatter.effort_rpe,
      tags: Array.isArray(frontmatter.health_tags)
        ? frontmatter.health_tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      etag: shortHash(JSON.stringify(frontmatter)),
    };
  };

  getDay = async (request: ApiRequests["getDay"]) => {
    const day = this.dayOf(request.name);
    const note = await this.vault.readDaily(day);
    return {
      name: request.name,
      path: this.vault.dailyPath(day),
      frontmatter: note?.frontmatter ?? {},
      body: note?.body,
    };
  };

  getCheckin = async (request: ApiRequests["getCheckin"]) => this.checkin(this.dayOf(request.name));

  updateCheckin = async (request: ApiRequests["updateCheckin"]) => {
    const checkin = request.checkin;
    const day = this.dayOf(checkin.name);
    const fields = requestedFields(request, checkin, ["feel", "rpe", "tags"]);
    await this.vault.update(this.vault.dailyPath(day), (source) =>
      editNote(
        source,
        { frontmatter: { date: day, tags: ["daily"] }, body: `# ${day}\n\n## Journal\n` },
        (note) => {
          if (checkin.etag && shortHash(JSON.stringify(note.frontmatter)) !== checkin.etag) {
            throw new ApiError(409, "stale etag");
          }
          applyCheckin(note.frontmatter, checkin, fields);
          return note;
        },
      ),
    );
    return this.checkin(day);
  };
}

function applyCheckin(frontmatter: Frontmatter, checkin: CheckinInput, fields: string[]) {
  for (const field of fields) {
    applyCheckinField(frontmatter, checkin, field);
  }
}

function applyCheckinField(frontmatter: Frontmatter, checkin: CheckinInput, field: string) {
  const key =
    ({ rpe: "effort_rpe", tags: "health_tags" } as Record<string, string>)[field] ?? field;
  const value = checkin[field as keyof CheckinInput];
  if (field === "tags") {
    frontmatter[key] = checkin.tags ?? [];
  } else if (value == null) {
    delete frontmatter[key];
  } else {
    frontmatter[key] = value;
  }
}
