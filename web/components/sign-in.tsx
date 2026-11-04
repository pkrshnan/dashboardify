// Asks once for a device token (one of INGEST_TOKENS) and keeps it in this browser.

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
      <p>Paste this device's token from INGEST_TOKENS on the server.</p>
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
