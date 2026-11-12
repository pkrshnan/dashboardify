// Strava's OAuth and v3 API in memory. It hands out a new refresh token on every refresh and
// forgets the old one, as Strava may, and answers 401 to anything stale.

export class FakeStrava {
  readonly clientId = "12345";
  readonly clientSecret = "app-secret";
  /** The code the approval page sends back. */
  readonly code = "approved-code";
  readonly athlete = { id: 777, firstname: "Pat", lastname: "Runner" };
  /** Every request, as "METHOD /path". */
  readonly requests: string[] = [];
  /** Seconds since the epoch, for `expires_at`. */
  now = 1_800_000_000;
  /** When set, every request fails with this status. */
  status?: number;
  deauthorized = false;
  private serial = 0;
  private refreshToken = "";
  private accessToken = "";

  readonly baseUrl = "https://www.strava.com";

  fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    this.requests.push(`${request.method} ${url.pathname}`);
    if (this.status) {
      return new Response("", { status: this.status });
    }
    if (request.method === "POST" && url.pathname === "/oauth/token") {
      return this.token(new URLSearchParams(await request.text()));
    }
    if (!this.authorized(request)) {
      return Response.json({ message: "Authorization Error" }, { status: 401 });
    }
    if (request.method === "POST" && url.pathname === "/oauth/deauthorize") {
      this.deauthorized = true;
      this.accessToken = "";
      this.refreshToken = "";
      return Response.json({ access_token: "" });
    }
    if (request.method === "GET" && url.pathname === "/api/v3/athlete") {
      return Response.json(this.athlete);
    }
    return new Response("", { status: 404 });
  };

  /** Makes the current access token stop working before it says it expires. */
  revokeAccess(): void {
    this.accessToken = "revoked";
  }

  /** Makes the stored refresh token stop working, as when you revoke the app on strava.com. */
  revokeAll(): void {
    this.revokeAccess();
    this.refreshToken = "revoked";
  }

  private token(form: URLSearchParams): Response {
    if (
      form.get("client_id") !== this.clientId ||
      form.get("client_secret") !== this.clientSecret
    ) {
      return Response.json({ message: "Bad Request" }, { status: 400 });
    }
    const grant = form.get("grant_type");
    if (grant === "authorization_code" && form.get("code") === this.code) {
      return Response.json({ ...this.issue(), athlete: this.athlete });
    }
    if (grant === "refresh_token" && form.get("refresh_token") === this.refreshToken) {
      return Response.json(this.issue());
    }
    return Response.json({ message: "Bad Request" }, { status: 400 });
  }

  private issue() {
    this.serial++;
    this.accessToken = `access-${this.serial}`;
    this.refreshToken = `refresh-${this.serial}`;
    return {
      token_type: "Bearer",
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      expires_at: this.now + 6 * 3600,
      expires_in: 6 * 3600,
    };
  }

  private authorized(request: Request): boolean {
    return (
      this.accessToken !== "" &&
      request.headers.get("authorization") === `Bearer ${this.accessToken}`
    );
  }
}
