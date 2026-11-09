import { beforeEach, describe, expect, test } from "bun:test";
import { FakeCalDav } from "../../calendar/fake-caldav";
import { useApi } from "./helpers";
import { expectNotInResponses } from "./secrets";

let server: FakeCalDav;
const PASSWORD = "abcd-efgh-ijkl-mnop";

function newServer() {
  return new FakeCalDav([
    { id: "home", displayName: "Personal" },
    { id: "work", displayName: "Work" },
    { id: "fitness", displayName: "Fitness" },
    { id: "dinners", displayName: "Dinners with Alex", writable: false },
    { id: "tasks", displayName: "Reminders", components: ["VTODO"] },
  ]);
}

const icloud = (password = PASSWORD) => ({
  kind: "KIND_CALDAV",
  provider: "icloud",
  username: "you@icloud.com",
  password,
});

describe("calendar accounts API", () => {
  const api = useApi({ calDav: () => server });
  const connect = () => api.call("/v1/calendarAccounts", "POST", icloud());

  beforeEach(() => {
    server = newServer();
  });

  test("validate_only signs in and lists calendars without saving", async () => {
    const { status, body } = await api.call(
      "/v1/calendarAccounts?validateOnly=true",
      "POST",
      icloud(),
    );
    const listed = await api.call("/v1/calendarAccounts");

    expect(status).toBe(200);
    expect(body.calendars.map((c: { displayName: string }) => c.displayName)).toEqual([
      "Personal",
      "Work",
      "Fitness",
      "Dinners with Alex",
    ]);
    expect(body.calendars[1]).toMatchObject({ category: "work", writable: true });
    // Protobuf JSON leaves out false booleans.
    expect(body.calendars[3].writable).toBeUndefined();
    expect(listed.body.calendarAccounts).toBeUndefined();
  });

  test("a wrong password is a clear FAILED_PRECONDITION, not a sign-out", async () => {
    const { status, body } = await api.call("/v1/calendarAccounts", "POST", icloud("wrong"));

    expect(status).toBe(400);
    expect(body.code).toBe("failed_precondition");
    expect(body.message).toContain("app-specific password");
  });

  test("create saves the account and calendars, and never returns the password", async () => {
    const created = await connect();
    const got = await api.call("/v1/calendarAccounts/icloud");
    const listed = await api.call("/v1/calendarAccounts");
    const calendars = await api.call("/v1/calendarAccounts/icloud/calendars");

    expect(created.body).toMatchObject({
      name: "calendarAccounts/icloud",
      username: "you@icloud.com",
      passwordSet: true,
      status: "STATUS_OK",
    });
    expect(calendars.body.calendars).toHaveLength(4);
    expectNotInResponses([created.body, got.body, listed.body, calendars.body], PASSWORD);
  });

  test("the password is stored sealed", async () => {
    await connect();

    const row = api.settings.db
      .query<{ password_sealed: Uint8Array }, []>("SELECT password_sealed FROM calendar_accounts")
      .get();

    expect(Buffer.from(row?.password_sealed ?? []).includes(Buffer.from(PASSWORD))).toBe(false);
  });

  test("the first writable calendar becomes the default", async () => {
    await connect();

    const { body } = await api.call("/v1/calendarSettings");

    expect(body.defaultCalendar).toBe("calendarAccounts/icloud/calendars/home");
  });

  test("a second iCloud account is ALREADY_EXISTS", async () => {
    await connect();

    const { status, body } = await api.call("/v1/calendarAccounts", "POST", icloud());

    expect(status).toBe(409);
    expect(body.code).toBe("already_exists");
  });

  test("replacing the password signs in with it first", async () => {
    await connect();
    server.password = "new-pass-word-0000";

    const wrong = await api.call("/v1/calendarAccounts/icloud?updateMask=password", "PATCH", {
      password: "still-wrong",
    });
    const right = await api.call("/v1/calendarAccounts/icloud?updateMask=password", "PATCH", {
      password: "new-pass-word-0000",
    });

    expect(wrong.status).toBe(400);
    expect(right.status).toBe(200);
    expectNotInResponses([right.body], "new-pass-word-0000");
  });

  test("sync picks up a new calendar, and a refused password marks the account", async () => {
    await connect();
    server.addCalendar({ id: "trips", displayName: "Trips" });

    await api.call("/v1/calendarAccounts/icloud:sync", "POST", {});
    const calendars = await api.call("/v1/calendarAccounts/icloud/calendars");
    server.password = "revoked-on-the-phone";
    const failed = await api.call("/v1/calendarAccounts/icloud:sync", "POST", {});
    const account = await api.call("/v1/calendarAccounts/icloud");

    expect(calendars.body.calendars).toHaveLength(5);
    expect(failed.status).toBe(400);
    expect(account.body.status).toBe("STATUS_AUTH_FAILED");
  });

  test("a calendar's category, visibility and read-only lock can change", async () => {
    await connect();

    const { body } = await api.call(
      "/v1/calendarAccounts/icloud/calendars/home?updateMask=category,forceReadOnly",
      "PATCH",
      { category: "focus", forceReadOnly: true },
    );

    expect(body).toMatchObject({ category: "focus", forceReadOnly: true });
    expect(body.writable).toBeUndefined();
  });

  test("the default calendar and rule targets must be writable", async () => {
    await connect();

    const readOnly = await api.call("/v1/calendarSettings", "PATCH", {
      defaultCalendar: "calendarAccounts/icloud/calendars/dinners",
    });
    const rules = await api.call("/v1/calendarSettings", "PATCH", {
      keywordRules: [
        { words: ["gym", " run "], calendar: "calendarAccounts/icloud/calendars/fitness" },
      ],
    });
    const badRule = await api.call("/v1/calendarSettings", "PATCH", {
      keywordRules: [{ words: ["dinner"], calendar: "calendarAccounts/icloud/calendars/dinners" }],
    });

    expect(readOnly.status).toBe(400);
    expect(rules.body.keywordRules).toEqual([
      { words: ["gym", "run"], calendar: "calendarAccounts/icloud/calendars/fitness" },
    ]);
    expect(badRule.status).toBe(400);
  });

  test("delete removes the account, its calendars and the default", async () => {
    await connect();

    const deleted = await api.call("/v1/calendarAccounts/icloud", "DELETE");
    const calendars = api.settings.db.query("SELECT count(*) AS n FROM calendars").get();
    const settings = await api.call("/v1/calendarSettings");

    expect(deleted.status).toBe(200);
    expect(calendars).toEqual({ n: 0 });
    expect(settings.body.defaultCalendar).toBeUndefined();
  });

  test("Connect serves the same service", async () => {
    const { status, body } = await api.call(
      "/dashboardify.v1.CalendarAccountService/CreateCalendarAccount",
      "POST",
      { calendarAccount: icloud(), validateOnly: true },
    );

    expect(status).toBe(200);
    expect(body.calendars).toHaveLength(4);
  });
});
