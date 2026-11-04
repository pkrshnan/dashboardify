// Shown only when the server wants a token: when the page is not opened through Tailscale, as in
// local development or the demo.

import { useState } from "preact/hooks";

export function SignIn({ onToken, failed }: { onToken: (token: string) => void; failed: boolean }) {
  const [token, setToken] = useState("");
  return (
    <form
      class="sign-in"
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim() !== "") {
          onToken(token.trim());
        }
      }}
    >
      <h2>Command center</h2>
      <p>Open this through Tailscale, or paste a device token from INGEST_TOKENS.</p>
      {failed && <p class="error">That token didn't work.</p>}
      <label class="quick-add">
        <input
          type="password"
          aria-label="Device token"
          autoComplete="current-password"
          value={token}
          onInput={(e) => setToken(e.currentTarget.value)}
        />
      </label>
      <button
        type="submit"
        class="pill-button"
        style={{ alignSelf: "flex-start", cursor: "pointer" }}
      >
        Sign in
      </button>
    </form>
  );
}
