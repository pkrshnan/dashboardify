// Settings › Devices: who can sign in with a token. Add device shows the new token once, as a QR
// code that opens the dashboard signed in on the phone, and as text to copy. Revoking this
// device signs you out, so it asks for a tick first.

import { useCallback, useEffect, useState } from "preact/hooks";
import { renderSVG } from "uqr";
import {
  createDevice,
  type DeviceView,
  deleteDevice,
  listDevices,
  randomKey,
  Unauthorized,
} from "../api";
import { canRevoke, closed, type Dialog, whenLabel } from "./device-dialog";
import type { SectionProps } from "./settings";
import { signInLink } from "./sign-in-link";

export function Devices({ token, onUnauthorized }: SectionProps) {
  const [devices, setDevices] = useState<DeviceView[] | null>(null);
  const [dialog, setDialog] = useState<Dialog>(closed());
  const load = useCallback(
    () =>
      listDevices(token).then(setDevices, (e: Error) =>
        e instanceof Unauthorized ? onUnauthorized(e.setup) : setDevices([]),
      ),
    [token, onUnauthorized],
  );
  useEffect(() => {
    load();
  }, [load]);
  const revoke = async (device: DeviceView) => {
    await deleteDevice(token, device.name);
    setDialog(closed());
    if (device.current) {
      onUnauthorized(false);
      return;
    }
    await load();
  };
  return (
    <div class="settings-pane">
      <div class="settings-pane-head">
        <h2>Devices</h2>
        <button
          type="button"
          class="pill-button"
          onClick={() => setDialog({ kind: "add", name: "" })}
        >
          + Add device
        </button>
      </div>
      <section class="settings-group">
        {(devices ?? []).map((d) => (
          <DeviceRow
            key={d.name}
            device={d}
            onRevoke={() => setDialog({ kind: "revoke", device: d, understood: false })}
          />
        ))}
        {devices?.length === 0 && <p class="muted">No devices. Tailnet sign-in still works.</p>}
      </section>
      <section class="settings-group">
        <h3>Tailscale</h3>
        <p class="settings-note">
          Anything opened through Tailscale with an allowed login signs in without a device token.
          Change who is allowed in General.
        </p>
      </section>
      <DeviceDialog
        dialog={dialog}
        token={token}
        onChange={setDialog}
        onRevoke={revoke}
        onAdded={load}
      />
    </div>
  );
}

function DeviceRow({ device, onRevoke }: { device: DeviceView; onRevoke: () => void }) {
  const now = new Date();
  return (
    <div class="device-row">
      <div class="device-main">
        <div>
          <span class="device-name">{device.displayName}</span>
          {device.current && <span class="device-tag">This device</span>}
        </div>
        <div class="settings-note">Added {whenLabel(device.createTime, now)}</div>
      </div>
      <span class="settings-note">{whenLabel(device.lastUsedTime, now)}</span>
      <button
        type="button"
        class="device-revoke"
        aria-label={`Revoke ${device.displayName}`}
        onClick={onRevoke}
      >
        Revoke
      </button>
    </div>
  );
}

interface DialogProps {
  dialog: Dialog;
  token: SectionProps["token"];
  onChange: (dialog: Dialog) => void;
  onRevoke: (device: DeviceView) => Promise<void>;
  onAdded: () => Promise<unknown>;
}

function DeviceDialog({ dialog, token, onChange, onRevoke, onAdded }: DialogProps) {
  if (dialog.kind === "closed") {
    return null;
  }
  return (
    <div class="dialog-backdrop">
      <div class="dialog" role="dialog" aria-modal="true">
        {dialog.kind === "add" && (
          <AddStep dialog={dialog} token={token} onChange={onChange} onAdded={onAdded} />
        )}
        {dialog.kind === "created" && (
          <TokenStep dialog={dialog} onDone={() => onChange(closed())} />
        )}
        {dialog.kind === "revoke" && (
          <RevokeStep dialog={dialog} onChange={onChange} onRevoke={onRevoke} />
        )}
      </div>
    </div>
  );
}

function AddStep(props: {
  dialog: Extract<Dialog, { kind: "add" }>;
  token: SectionProps["token"];
  onChange: (dialog: Dialog) => void;
  onAdded: () => Promise<unknown>;
}) {
  const { dialog, onChange } = props;
  const [requestId] = useState(randomKey);
  const create = async (e: Event) => {
    e.preventDefault();
    try {
      const made = await createDevice(props.token, dialog.name.trim(), requestId);
      onChange({ kind: "created", displayName: made.displayName, token: made.token });
      await props.onAdded();
    } catch (error) {
      onChange({ ...dialog, error: (error as Error).message });
    }
  };
  return (
    <form class="dialog-body" onSubmit={create}>
      <h2>Add device</h2>
      <label class="setup-field">
        <span>Name</span>
        <input
          type="text"
          value={dialog.name}
          placeholder="iPad"
          onInput={(e) => onChange({ ...dialog, name: e.currentTarget.value })}
        />
      </label>
      <span class="settings-note">Shown in this list and in the server log.</span>
      {dialog.error && <span class="settings-note bad">{dialog.error}</span>}
      <div class="dialog-actions">
        <button type="button" class="pill-button" onClick={() => props.onChange(closed())}>
          Cancel
        </button>
        <button type="submit" class="capture-add" disabled={!dialog.name.trim()}>
          Create token
        </button>
      </div>
    </form>
  );
}

function TokenStep({
  dialog,
  onDone,
}: {
  dialog: Extract<Dialog, { kind: "created" }>;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const qr = renderSVG(signInLink(window.location.origin, dialog.token), {
    whiteColor: "#F5F5F7",
    blackColor: "#0C0C0E",
  });
  return (
    <div class="dialog-body">
      <h2>{dialog.displayName} added</h2>
      <div class="device-qr">
        <img
          class="device-qr-code"
          src={`data:image/svg+xml,${encodeURIComponent(qr)}`}
          alt={`QR code that signs ${dialog.displayName} in`}
        />
        <p class="settings-note">
          Scan with the {dialog.displayName}'s camera to open the dashboard signed in.
        </p>
      </div>
      <span class="settings-note">Or paste the token</span>
      <div class="device-token">
        <code>{dialog.token}</code>
        <button
          type="button"
          class="pill-button"
          onClick={() => navigator.clipboard.writeText(dialog.token).then(() => setCopied(true))}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p class="settings-note">
        You won't see this token again. Revoke the device and add it again if you lose it.
      </p>
      <div class="dialog-actions">
        <button type="button" class="capture-add" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function RevokeStep(props: {
  dialog: Extract<Dialog, { kind: "revoke" }>;
  onChange: (dialog: Dialog) => void;
  onRevoke: (device: DeviceView) => Promise<void>;
}) {
  const { dialog } = props;
  const { device } = dialog;
  return (
    <div class={`dialog-body${device.current ? " danger" : ""}`}>
      <h2>Revoke {device.displayName}?</h2>
      <p class="settings-note">
        {device.current
          ? "This is the device you're using. You'll be signed out here and need another device or a setup code to get back in."
          : "Its token stops working on its next request. You can add it again later."}
      </p>
      {device.current && (
        <label class="device-understood">
          <input
            type="checkbox"
            checked={dialog.understood}
            onChange={(e) => props.onChange({ ...dialog, understood: e.currentTarget.checked })}
          />
          I understand I'll be signed out
        </label>
      )}
      <div class="dialog-actions">
        <button type="button" class="pill-button" onClick={() => props.onChange(closed())}>
          Cancel
        </button>
        <button
          type="button"
          class="device-revoke strong"
          disabled={!canRevoke(dialog)}
          onClick={() => props.onRevoke(device)}
        >
          Revoke
        </button>
      </div>
    </div>
  );
}
