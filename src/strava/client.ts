// Talks to Strava's OAuth and v3 API. Access tokens last six hours; one is refreshed when it has
// five minutes left, and the refresh token Strava returns replaces the stored one at once.

import type { StravaAccounts, Tokens } from "./account";

export const STRAVA_URL = "https://www.strava.com";

/** Private activities count too, so runs you keep to yourself are seen. */
export const SCOPE = "activity:read_all";

/** Strava only checks the host against the app's callback domain; nothing listens here. */
export const REDIRECT_URI = "http://localhost/strava";

const REFRESH_EARLY_MS = 5 * 60_000;
const TIMEOUT_MS = 30_000;

type Fetch = (request: Request) => Promise<Response>;

/** Strava refused the app or the tokens; connecting again fixes it. */
export class StravaAuthFailed extends Error {}

/** Strava was unreachable, rate limited or failing; try again later. */
export class StravaUnavailable extends Error {}

export interface Connected {
  athlete: { id: number; name: string };
  tokens: Tokens;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  /** Seconds since the epoch. */
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
}

/** The page you approve the app on. */
export function authorizeUrl(clientId: string, baseUrl = STRAVA_URL): string {
  const url = new URL("/oauth/authorize", baseUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", SCOPE);
  return url.toString();
}

/**
 * The code from the address Strava sent you to, or the bare code. Throws if you unticked the
 * private-activities box, since runs marked "only you" would then be missed.
 */
export function codeFrom(pasted: string): string {
  const text = pasted.trim();
  if (!text.includes("=")) {
    return text;
  }
  const params = new URL(text, REDIRECT_URI).searchParams;
  if (params.get("error")) {
    throw new StravaAuthFailed(`Strava said: ${params.get("error")}`);
  }
  const scopes = (params.get("scope") ?? "").split(",");
  if (params.has("scope") && !scopes.includes(SCOPE)) {
    throw new StravaAuthFailed("Allow viewing private activities, then try again.");
  }
  const code = params.get("code");
  if (!code) {
    throw new StravaAuthFailed("That address has no code in it.");
  }
  return code;
}

export class StravaClient {
  constructor(
    private readonly accounts: StravaAccounts,
    private readonly fetch: Fetch = (request) => globalThis.fetch(request),
    private readonly baseUrl = STRAVA_URL,
    private readonly now: () => number = Date.now,
  ) {}

  /** Trades the code from the approval page for tokens and the athlete. */
  async exchange(
    app: { clientId: string; clientSecret: string },
    code: string,
  ): Promise<Connected> {
    const body = await this.token({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      grant_type: "authorization_code",
    });
    const athlete = body.athlete;
    if (!athlete) {
      throw new StravaUnavailable("Strava didn't say who you are.");
    }
    const name = [athlete.firstname, athlete.lastname].filter(Boolean).join(" ");
    return { athlete: { id: athlete.id, name: name || String(athlete.id) }, tokens: tokens(body) };
  }

  /** GET a v3 path as the connected athlete. */
  async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(`/api/v3${path}`, this.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    let response = await this.send(url, await this.accessToken());
    if (response.status === 401) {
      // Revoked early, or the clock is off: one refresh, then give up.
      response = await this.send(url, await this.accessToken(true));
    }
    if (response.status === 401) {
      throw this.authFailed("Strava refused the token. Connect again.");
    }
    if (!response.ok) {
      throw new StravaUnavailable(`Strava answered ${response.status} for ${path}`);
    }
    return (await response.json()) as T;
  }

  /** Revokes the app's access. Already revoked counts as done. */
  async deauthorize(): Promise<void> {
    const response = await this.request(
      new Request(new URL("/oauth/deauthorize", this.baseUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${await this.accessToken()}` },
      }),
    );
    if (!response.ok && response.status !== 401) {
      throw new StravaUnavailable(`Strava answered ${response.status} to deauthorize`);
    }
  }

  private async accessToken(force = false): Promise<string> {
    const current = this.accounts.credentials();
    if (!current) {
      throw new StravaAuthFailed("Strava isn't connected.");
    }
    if (!force && current.expireTime.getTime() - this.now() > REFRESH_EARLY_MS) {
      return current.accessToken;
    }
    let body: TokenResponse;
    try {
      body = await this.token({
        client_id: current.clientId,
        client_secret: current.clientSecret,
        refresh_token: current.refreshToken,
        grant_type: "refresh_token",
      });
    } catch (error) {
      throw error instanceof StravaAuthFailed ? this.authFailed(error.message) : error;
    }
    const next = tokens(body);
    this.accounts.saveTokens(next);
    return next.accessToken;
  }

  private async token(form: Record<string, string>): Promise<TokenResponse> {
    const response = await this.request(
      new Request(new URL("/oauth/token", this.baseUrl), {
        method: "POST",
        body: new URLSearchParams(form),
      }),
    );
    if (response.status === 400 || response.status === 401) {
      throw new StravaAuthFailed("Strava refused the app's ID, secret or code.");
    }
    if (!response.ok) {
      throw new StravaUnavailable(`Strava answered ${response.status} for a token`);
    }
    return (await response.json()) as TokenResponse;
  }

  private send(url: URL, token: string): Promise<Response> {
    return this.request(new Request(url, { headers: { authorization: `Bearer ${token}` } }));
  }

  private async request(request: Request): Promise<Response> {
    try {
      return await this.fetch(new Request(request, { signal: AbortSignal.timeout(TIMEOUT_MS) }));
    } catch (error) {
      throw new StravaUnavailable(`Strava unreachable: ${(error as Error).message}`);
    }
  }

  private authFailed(detail: string): StravaAuthFailed {
    this.accounts.setStatus("auth_failed", detail);
    return new StravaAuthFailed(detail);
  }
}

function tokens(body: TokenResponse): Tokens {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expireTime: new Date(body.expires_at * 1000),
  };
}
