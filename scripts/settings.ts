// bun run settings <command>: manage settings.db from the terminal. It opens the same database
// as the server (DATA_PATH, default ./data), so it needs the same access to the server's files.
//
//   export [--out file]   settings, devices and calendars as TOML, without secrets
//   devices add <name>    add a device and print its token, once
//   devices list          names, when added and last used
//   devices revoke <id>   its token stops working on the server's next request
//   key show              the key as base64, for your password manager
//   rotate-key            a new key; every secret is re-sealed. Stop the server first.
//   strava connect        asks for your Strava API app, then the address Strava sends you to
//   strava disconnect     revokes the app's access and forgets the account
//   strava status         who is connected and whether it is working

import { join, resolve } from "node:path";
import "../src/calendar/accounts";
import "../src/settings/core";
import { DeviceStore } from "../src/settings/devices";
import { exportToml } from "../src/settings/export";
import { loadKey } from "../src/settings/key";
import { rotateKey, serverRunning } from "../src/settings/rotate";
import { SecretBox } from "../src/settings/secret-box";
import { SettingsStore } from "../src/settings/store";
import { StravaAccounts } from "../src/strava/account";
import {
  authorizeUrl,
  codeFrom,
  StravaAuthFailed,
  StravaClient,
  StravaUnavailable,
} from "../src/strava/client";

const dataPath = resolve(process.env.DATA_PATH ?? "data");
const keyFile = process.env.SECRET_KEY_FILE ? resolve(process.env.SECRET_KEY_FILE) : undefined;
const [command, ...args] = process.argv.slice(2);

async function main(): Promise<number> {
  const key = await loadKey({ dataPath, keyFile });
  const store = await SettingsStore.open(dataPath, new SecretBox(key));
  try {
    return await run(store, key);
  } finally {
    store.close();
  }
}

async function run(store: SettingsStore, key: Uint8Array): Promise<number> {
  if (command === "export") {
    return exportCommand(store);
  }
  switch (`${command ?? ""} ${args[0] ?? ""}`.trim()) {
    case "devices add":
      return devicesAdd(store, args.slice(1).join(" "));
    case "devices list":
      return devicesList(store);
    case "devices revoke":
      return devicesRevoke(store, args[1] ?? "");
    case "key show":
      console.log(Buffer.from(key).toString("base64"));
      return 0;
    case "rotate-key":
      return rotate(store);
    case "strava connect":
      return stravaConnect(store);
    case "strava disconnect":
      return stravaDisconnect(store);
    case "strava status":
      return stravaStatus(store);
    default:
      console.error(
        "Usage: bun run settings export [--out file] | devices add <name> | devices list | devices revoke <id> | key show | rotate-key | strava connect | strava disconnect | strava status",
      );
      return 2;
  }
}

async function exportCommand(store: SettingsStore): Promise<number> {
  const toml = exportToml(store);
  const out = args[0] === "--out" ? args[1] : undefined;
  if (out) {
    await Bun.write(out, toml);
    console.log(`Wrote ${out}`);
  } else {
    process.stdout.write(toml);
  }
  return 0;
}

function devicesAdd(store: SettingsStore, name: string): number {
  if (!name.trim()) {
    console.error("Usage: bun run settings devices add <name>");
    return 2;
  }
  const { device, token } = new DeviceStore(store).add(name);
  console.log(`Added ${device.displayName} (${device.id}). Its token, shown only now:`);
  console.log(token);
  return 0;
}

function devicesList(store: SettingsStore): number {
  for (const device of new DeviceStore(store).list()) {
    const used = device.lastUsedTime ? `last used ${device.lastUsedTime}` : "never used";
    console.log(`${device.id}\t${device.displayName}\tadded ${device.createTime}\t${used}`);
  }
  return 0;
}

function devicesRevoke(store: SettingsStore, id: string): number {
  if (!new DeviceStore(store).revoke(id)) {
    console.error(`No device ${id}. See: bun run settings devices list`);
    return 1;
  }
  console.log(`Revoked ${id}.`);
  return 0;
}

async function rotate(store: SettingsStore): Promise<number> {
  const pid = await serverRunning(dataPath);
  if (pid) {
    console.error(`The server is running (pid ${pid}). Stop it, then run rotate-key again.`);
    return 1;
  }
  const keyPath = keyFile ?? join(dataPath, "secret.key");
  const { values, key } = await rotateKey(store, keyPath);
  console.log(`Re-sealed ${values} secret${values === 1 ? "" : "s"} with a new key in ${keyPath}.`);
  console.log("Save the new key in your password manager:");
  console.log(Buffer.from(key).toString("base64"));
  return 0;
}

async function stravaConnect(store: SettingsStore): Promise<number> {
  const accounts = new StravaAccounts(store);
  const current = accounts.get();
  if (current) {
    console.error(`Strava is already connected as ${current.athleteName}. Disconnect it first.`);
    return 1;
  }
  console.log("Make an app at https://www.strava.com/settings/api with callback domain localhost.");
  const clientId = prompt("Client ID:")?.trim() ?? "";
  const clientSecret = prompt("Client secret:")?.trim() ?? "";
  if (!(clientId && clientSecret)) {
    console.error("Both the client ID and secret are needed.");
    return 2;
  }
  console.log("Open this, approve, and copy the address you land on (the page won't load):");
  console.log(authorizeUrl(clientId));
  const pasted = prompt("Address:") ?? "";
  return stravaErrors(async () => {
    const app = { clientId, clientSecret };
    const { athlete, tokens } = await new StravaClient(accounts).exchange(app, codeFrom(pasted));
    accounts.create(athlete, app, tokens);
    console.log(`Connected ${athlete.name}.`);
  });
}

async function stravaDisconnect(store: SettingsStore): Promise<number> {
  const accounts = new StravaAccounts(store);
  if (!accounts.get()) {
    console.error("Strava isn't connected.");
    return 1;
  }
  try {
    await new StravaClient(accounts).deauthorize();
  } catch (error) {
    // Forget it anyway: you can revoke the app on strava.com/settings/apps.
    console.error(`Couldn't revoke access (${(error as Error).message}); forgetting it anyway.`);
  }
  accounts.delete();
  console.log("Disconnected Strava.");
  return 0;
}

function stravaStatus(store: SettingsStore): number {
  const account = new StravaAccounts(store).get();
  if (!account) {
    console.log("Strava isn't connected. Run: bun run settings strava connect");
    return 0;
  }
  const synced = account.lastSyncTime ? `last synced ${account.lastSyncTime}` : "not synced yet";
  const state = account.status === "ok" ? "working" : `${account.status}: ${account.statusDetail}`;
  console.log(`${account.athleteName} (athlete ${account.athleteId}), ${state}, ${synced}`);
  return 0;
}

async function stravaErrors(fn: () => Promise<void>): Promise<number> {
  try {
    await fn();
    return 0;
  } catch (error) {
    if (error instanceof StravaAuthFailed || error instanceof StravaUnavailable) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exit(await main());
