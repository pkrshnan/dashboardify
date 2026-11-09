// Shown only when the server wants a token: when the page is not opened through Tailscale, as in
// local development or the demo. On a fresh install it opens on "Set up this device", which uses
// the one-time code the server printed to add this browser as a device.

import { useState } from "preact/hooks";
import { setUpDevice } from "../api";

interface Props {
  onToken: (token: string) => void;
  failed: boolean;
  /** The server is waiting for its setup code. */
  setup: boolean;
}

export function SignIn({ onToken, failed, setup }: Props) {
  const [mode, setMode] = useState<"setup" | "token">(setup ? "setup" : "token");
  return mode === "setup" ? (
    <SetUp onToken={onToken} onUseToken={() => setMode("token")} />
  ) : (
    <TokenSignIn onToken={onToken} failed={failed} />
  );
}

function TokenSignIn({ onToken, failed }: { onToken: (token: string) => void; failed: boolean }) {
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
      <p>
        Open this through Tailscale, or paste a device token. Make one with{" "}
        <code>bun run settings devices add</code>.
      </p>
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

function SetUp({
  onToken,
  onUseToken,
}: {
  onToken: (token: string) => void;
  onUseToken: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(defaultName);
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!(code.trim() && name.trim()) || state === "busy") {
      return;
    }
    setState("busy");
    try {
      onToken(await setUpDevice(code.trim(), name.trim()));
    } catch {
      setState("failed");
    }
  };
  return (
    <form class="sign-in" onSubmit={submit}>
      <h2>Set up this device</h2>
      <p>When the server started, it printed a setup code:</p>
      <pre class="setup-line">
        No devices yet. Open … and enter setup code XXXX-XXXX (valid 15 minutes).
      </pre>
      {state === "failed" && (
        <p class="error">
          That code didn't work. It works once, for 15 minutes; restart the server for a new one.
        </p>
      )}
      <label class="setup-field">
        <span>Setup code</span>
        <input
          class="setup-code"
          type="text"
          placeholder="XXXX-XXXX"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          value={code}
          onInput={(e) => setCode(e.currentTarget.value)}
        />
      </label>
      <label class="setup-field">
        <span>Name this device</span>
        <input type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <button
        type="submit"
        class="pill-button"
        disabled={state === "busy"}
        style={{ alignSelf: "flex-start", cursor: "pointer" }}
      >
        {state === "busy" ? "Setting up…" : "Set up"}
      </button>
      <button
        type="button"
        class="link"
        style={{ alignSelf: "flex-start", padding: 0 }}
        onClick={onUseToken}
      >
        I have a device token
      </button>
    </form>
  );
}

/** "Mac", "iPhone" or "This browser", as a first guess the user can change. */
function defaultName(): string {
  const agent = navigator.userAgent;
  if (/iPhone/.test(agent)) {
    return "iPhone";
  }
  if (/iPad/.test(agent)) {
    return "iPad";
  }
  if (/Macintosh/.test(agent)) {
    return "Mac";
  }
  return /Linux/.test(agent) ? "Linux" : "This browser";
}
