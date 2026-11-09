// CalendarAccountService: connect one iCloud account, choose how its calendars show, and say
// where new events go. Creating or replacing a password signs in first, so a wrong one is
// caught in Settings rather than at the next sync. The password is never returned.

import {
  type Account,
  AccountExists,
  type CalendarAccounts,
  type CalendarPreferences,
  type Category,
  type FoundCalendar,
  guessCategory,
  type StoredCalendar,
} from "../../calendar/accounts";
import {
  CalDavClient,
  type CalDavError,
  Unauthorized,
  UnsafeRedirect,
} from "../../calendar/caldav";
import { FeedError, FeedGone, feedName, feedUrl, fetchFeed } from "../../calendar/feed";
import { readOccurrences } from "../../calendar/ical";
import { slug } from "../../settings/devices";
import { ApiError, failedPrecondition, invalidArgument } from "./errors";
import { requestedFields } from "./update-mask";

/** The iCloud defaults: where discovery starts, and the only domain the password may go to. */
const ICLOUD = { serverUrl: "https://caldav.icloud.com/", domains: ["icloud.com"] };

const BAD_PASSWORD =
  "iCloud didn't accept that password. Use an app-specific password from account.apple.com, not your Apple ID password.";

/** Makes the client for an account; tests hand it the fake server. */
export type ConnectCalDav = (account: {
  serverUrl: string;
  username: string;
  password: string;
}) => CalDavClient;

export const connectICloud: ConnectCalDav = (account) =>
  new CalDavClient({ ...account, allowedDomains: ICLOUD.domains });

interface AccountInput {
  name?: string;
  feedUrl?: string;
  kind?: string;
  provider?: string;
  displayName?: string;
  serverUrl?: string;
  username?: string;
  password?: string;
  etag?: string;
}

interface CalendarInput {
  name: string;
  category?: string;
  enabled?: boolean;
  forceReadOnly?: boolean;
}

export class CalendarAccountService {
  constructor(
    private readonly accounts: CalendarAccounts,
    private readonly connect: ConnectCalDav = connectICloud,
    /** How calendar links are fetched; tests pass a fake server. */
    private readonly feedFetch?: (request: Request) => Promise<Response>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  listCalendarAccounts = async () => ({
    calendarAccounts: this.accounts.list().map((account) => accountView(account)),
  });

  getCalendarAccount = async (request: { name: string }) => accountView(this.account(request.name));

  createCalendarAccount = async (request: {
    calendarAccount: AccountInput;
    calendarAccountId?: string;
    validateOnly?: boolean;
  }) => {
    const input = request.calendarAccount;
    if (input.kind === "KIND_ICS") {
      return this.createLink(input, request.calendarAccountId, request.validateOnly ?? false);
    }
    if (!(input.username?.trim() && input.password)) {
      invalidArgument("calendar_account.username and calendar_account.password are required");
    }
    const id = request.calendarAccountId || "icloud";
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(id)) {
      invalidArgument("calendar_account_id must be a lower-case slug");
    }
    if (this.accounts.list().some((account) => account.kind === "caldav")) {
      throw new ApiError(
        409,
        "There is already an iCloud account. Remove it first to use another.",
        "already_exists",
      );
    }
    const serverUrl = input.serverUrl || ICLOUD.serverUrl;
    const login = { serverUrl, username: input.username.trim(), password: input.password };
    const { homeUrl, calendars } = await this.signIn(login);
    if (request.validateOnly) {
      return previewView(id, login, input.displayName, calendars);
    }
    return this.save(id, login, input.displayName, homeUrl, calendars);
  };

  updateCalendarAccount = async (request: {
    calendarAccount: AccountInput & { name: string };
    updateMask?: string;
  }) => {
    const current = this.account(request.calendarAccount.name);
    const input = request.calendarAccount;
    if (input.etag && input.etag !== etagOf(current)) {
      throw new ApiError(409, "The account changed since you loaded it. Reload and try again.");
    }
    if (current.kind === "ics") {
      return this.updateLink(
        current,
        input,
        requestedFields(request, input, ["displayName", "feedUrl"]),
      );
    }
    const fields = requestedFields(request, input, ["displayName", "password"]);
    const change: { displayName?: string; password?: string } = {};
    if (fields.includes("password")) {
      if (!input.password) {
        invalidArgument("calendar_account.password is required");
      }
      await this.signIn({ ...current, password: input.password });
      change.password = input.password;
    }
    if (fields.includes("displayName")) {
      change.displayName = input.displayName?.trim() || "iCloud";
    }
    return accountView(this.accounts.update(current.id, change));
  };

  deleteCalendarAccount = async (request: { name: string }) => {
    this.accounts.delete(this.account(request.name).id);
    return {};
  };

  syncCalendarAccount = async (request: { name: string }) => {
    const account = this.account(request.name);
    if (account.kind === "ics") {
      // Links are fetched by the sync loop every 15 minutes.
      return accountView(account);
    }
    try {
      const { calendars } = await this.signIn({
        ...account,
        password: this.accounts.password(account.id),
      });
      this.accounts.refreshCalendars(account.id, calendars);
    } catch (error) {
      this.accounts.setStatus(
        account.id,
        statusOf(error),
        error instanceof Error ? error.message : undefined,
      );
      throw error;
    }
    return accountView(this.account(request.name));
  };

  listCalendars = async (request: { parent: string }) => {
    const account = this.account(request.parent);
    return { calendars: this.accounts.calendars(account.id).map(calendarView) };
  };

  updateCalendar = async (request: { calendar: CalendarInput; updateMask?: string }) => {
    const [accountId, id] = calendarParts(request.calendar.name);
    if (!this.accounts.calendar(accountId, id)) {
      throw new ApiError(404, "calendar not found");
    }
    const input = request.calendar;
    const fields = requestedFields(request, input, ["category", "enabled", "forceReadOnly"]);
    const change: Partial<Pick<StoredCalendar, "category" | "enabled" | "forceReadOnly">> = {};
    if (fields.includes("category")) {
      change.category = (input.category || "personal") as Category;
    }
    if (fields.includes("enabled")) {
      change.enabled = input.enabled ?? false;
    }
    if (fields.includes("forceReadOnly")) {
      change.forceReadOnly = input.forceReadOnly ?? false;
    }
    return calendarView(this.accounts.updateCalendar(accountId, id, change));
  };

  getCalendarSettings = async () => this.settingsView(this.accounts.preferences());

  updateCalendarSettings = async (request: {
    calendarSettings: {
      defaultCalendar?: string;
      keywordRules?: { words?: string[]; calendar?: string }[];
    };
    updateMask?: string;
  }) => {
    const input = request.calendarSettings;
    const fields = requestedFields(request, input, ["defaultCalendar", "keywordRules"]);
    const next = { ...this.accounts.preferences() };
    if (fields.includes("defaultCalendar")) {
      next.defaultCalendar = input.defaultCalendar
        ? this.writableKey(input.defaultCalendar)
        : undefined;
    }
    if (fields.includes("keywordRules")) {
      next.keywordRules = (input.keywordRules ?? []).map((rule) => ({
        words: (rule.words ?? []).map((word) => word.trim()).filter(Boolean),
        calendar: this.writableKey(rule.calendar ?? ""),
      }));
    }
    this.accounts.setPreferences(next);
    return this.settingsView(next);
  };

  /** Fetches the link once to check it, then saves it (unless only validating). */
  private async createLink(
    input: AccountInput,
    requestedId: string | undefined,
    validateOnly: boolean,
  ) {
    const { url, ics } = await this.checkLink(input.feedUrl ?? "");
    const name = input.displayName?.trim() || feedName(ics) || url.host;
    const eventCount = this.countEvents(ics);
    const category = guessCategory(name);
    if (validateOnly) {
      return {
        kind: "KIND_ICS",
        provider: "url",
        displayName: name,
        feedHost: url.host,
        eventCount,
        calendars: [{ displayName: name, category, enabled: true, writable: false }],
      };
    }
    const id = requestedId || this.freeId(slug(name));
    const account = this.accounts.createLink({
      id,
      displayName: name,
      url: url.href,
      host: url.host,
      category,
    });
    return {
      ...accountView(account),
      eventCount,
      calendars: this.accounts.calendars(id).map(calendarView),
    };
  }

  private async updateLink(current: Account, input: AccountInput, fields: string[]) {
    const change: { url?: string; host?: string; displayName?: string } = {};
    if (fields.includes("feedUrl")) {
      const { url } = await this.checkLink(input.feedUrl ?? "");
      change.url = url.href;
      change.host = url.host;
    }
    if (fields.includes("displayName") && input.displayName?.trim()) {
      change.displayName = input.displayName.trim();
    }
    return accountView(this.accounts.updateLink(current.id, change));
  }

  /** The link must be https (or webcal) and answer with iCalendar. Errors name only the host. */
  private async checkLink(input: string) {
    try {
      const url = feedUrl(input);
      const result = await fetchFeed(url.href, {}, this.feedFetch);
      return { url, ics: result.kind === "ok" ? result.ics : "" };
    } catch (error) {
      if (error instanceof FeedError || error instanceof FeedGone) {
        invalidArgument(error.message);
      }
      throw error;
    }
  }

  private countEvents(ics: string): number {
    const from = this.now();
    const to = new Date(from.getTime() + 60 * 86_400_000);
    try {
      return readOccurrences(ics, { from, to, floatingZone: "UTC" }).length;
    } catch {
      invalidArgument("That link isn't a calendar feed.");
    }
  }

  private freeId(base: string): string {
    let id = base;
    for (let n = 2; this.accounts.get(id); n++) {
      id = `${base}-${n}`;
    }
    return id;
  }

  /** Signs in and lists event calendars. A refused password is FAILED_PRECONDITION. */
  private async signIn(login: { serverUrl: string; username: string; password: string }) {
    try {
      const client = this.connect(login);
      const homeUrl = await client.discover();
      const found = await client.listCalendars(homeUrl);
      const calendars: FoundCalendar[] = found.map((calendar) => ({
        href: calendar.url,
        displayName: calendar.displayName,
        color: calendar.color,
        writable: calendar.writable,
      }));
      return { homeUrl, calendars };
    } catch (error) {
      if (error instanceof Unauthorized) {
        failedPrecondition(BAD_PASSWORD);
      }
      if (error instanceof UnsafeRedirect) {
        failedPrecondition(error.message);
      }
      throw new ApiError(
        503,
        `Couldn't reach the calendar server: ${(error as CalDavError).message}`,
      );
    }
  }

  private save(
    id: string,
    login: { serverUrl: string; username: string; password: string },
    displayName: string | undefined,
    homeUrl: string,
    calendars: FoundCalendar[],
  ) {
    let account: Account;
    try {
      account = this.accounts.create(
        { id, provider: "icloud", displayName: displayName?.trim() || "iCloud", homeUrl, ...login },
        calendars,
      );
    } catch (error) {
      if (error instanceof AccountExists) {
        throw new ApiError(409, error.message, "already_exists");
      }
      throw error;
    }
    const preferences = this.accounts.preferences();
    const firstWritable = this.accounts.calendars(id).find((calendar) => calendar.serverWritable);
    if (!preferences.defaultCalendar && firstWritable) {
      this.accounts.setPreferences({
        ...preferences,
        defaultCalendar: `${id}/${firstWritable.id}`,
      });
    }
    return { ...accountView(account), calendars: this.accounts.calendars(id).map(calendarView) };
  }

  private account(name: string): Account {
    const id = name.startsWith("calendarAccounts/") ? name.slice("calendarAccounts/".length) : "";
    const account = id ? this.accounts.get(id) : undefined;
    if (!account) {
      throw new ApiError(404, "calendar account not found");
    }
    return account;
  }

  /** "calendarAccounts/a/calendars/c" → "a/c", if that calendar takes new events. */
  private writableKey(name: string): string {
    const [accountId, id] = calendarParts(name);
    if (!this.accounts.calendar(accountId, id)) {
      invalidArgument(`${name} is not a calendar`);
    }
    if (!this.accounts.writable(accountId, id)) {
      invalidArgument(`${name} is read-only, so new events can't go on it`);
    }
    return `${accountId}/${id}`;
  }

  private settingsView(preferences: CalendarPreferences) {
    const resource = (key: string) => {
      const [accountId, id] = key.split("/");
      return `calendarAccounts/${accountId}/calendars/${id}`;
    };
    return {
      name: "calendarSettings",
      defaultCalendar: preferences.defaultCalendar ? resource(preferences.defaultCalendar) : "",
      keywordRules: preferences.keywordRules.map((rule) => ({
        words: rule.words,
        calendar: resource(rule.calendar),
      })),
    };
  }
}

function calendarParts(name: string): [string, string] {
  const match = /^calendarAccounts\/([^/]+)\/calendars\/([^/]+)$/.exec(name);
  if (!match) {
    throw new ApiError(404, "calendar not found");
  }
  return [match[1] ?? "", match[2] ?? ""];
}

function statusOf(error: unknown) {
  return error instanceof ApiError && error.code === "failed_precondition"
    ? "auth_failed"
    : "unreachable";
}

const STATUS = {
  ok: "STATUS_OK",
  auth_failed: "STATUS_AUTH_FAILED",
  unreachable: "STATUS_UNREACHABLE",
};

function accountView(account: Account) {
  return {
    name: `calendarAccounts/${account.id}`,
    kind: account.kind === "ics" ? "KIND_ICS" : "KIND_CALDAV",
    ...(account.kind === "ics" && { feedUrlSet: true, feedHost: account.feedHost ?? "" }),
    provider: account.provider,
    displayName: account.displayName,
    serverUrl: account.serverUrl,
    username: account.username,
    passwordSet: account.passwordSet,
    ...(account.lastUsedTime && { lastUsedTime: account.lastUsedTime }),
    ...(account.lastSyncTime && { lastSyncTime: account.lastSyncTime }),
    status: STATUS[account.status],
    ...(account.statusDetail && { statusDetail: account.statusDetail }),
    etag: etagOf(account),
  };
}

/** What `validate_only` returns: the account as it would be saved, with what was found. */
function previewView(
  id: string,
  login: { serverUrl: string; username: string },
  displayName: string | undefined,
  calendars: FoundCalendar[],
) {
  return {
    name: `calendarAccounts/${id}`,
    kind: "KIND_CALDAV",
    provider: "icloud",
    displayName: displayName?.trim() || "iCloud",
    serverUrl: login.serverUrl,
    username: login.username,
    passwordSet: false,
    status: "STATUS_OK",
    calendars: calendars.map((calendar) => ({
      displayName: calendar.displayName,
      ...(calendar.color && { serverColor: calendar.color }),
      category: guessCategory(calendar.displayName),
      enabled: true,
      writable: calendar.writable,
    })),
  };
}

function calendarView(calendar: StoredCalendar) {
  return {
    name: `calendarAccounts/${calendar.accountId}/calendars/${calendar.id}`,
    displayName: calendar.displayName,
    ...(calendar.serverColor && { serverColor: calendar.serverColor }),
    category: calendar.category,
    enabled: calendar.enabled,
    forceReadOnly: calendar.forceReadOnly,
    writable: calendar.serverWritable && !calendar.forceReadOnly,
  };
}

function etagOf(account: Account): string {
  return `"${account.updateTime}"`;
}
