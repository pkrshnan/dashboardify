// A link that opens the dashboard already signed in as a new device: what the Add device QR
// code holds. The token travels in the fragment, which browsers never send to the server.

const PREFIX = "#token=";

export function signInLink(origin: string, token: string): string {
  return `${origin}/${PREFIX}${encodeURIComponent(token)}`;
}

/** The token from a sign-in link's fragment, if this page was opened from one. */
export function tokenFromHash(hash: string): string | undefined {
  if (!hash.startsWith(PREFIX)) {
    return undefined;
  }
  const token = decodeURIComponent(hash.slice(PREFIX.length));
  return token || undefined;
}
