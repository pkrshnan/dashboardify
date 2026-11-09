// bun run settings <command>: manage settings.db from the terminal. It opens the same database
// as the server (DATA_PATH, default ./data), so it needs the same access to the server's files.
//
//   export [--out file]   settings, devices and calendars as TOML, without secrets
//   devices add <name>    add a device and print its token, once
//   devices list          names, when added and last used
//   devices revoke <id>   its token stops working on the server's next request
//   key show              the key as base64, for your password manager
//   rotate-key            a new key; every secret is re-sealed. Stop the server first.

import { join, resolve } from "node:path";
import "../src/calendar/accounts";
import "../src/settings/core";
import { DeviceStore } from "../src/settings/devices";
import { exportToml } from "../src/settings/export";
import { loadKey } from "../src/settings/key";
import { rotateKey, serverRunning } from "../src/settings/rotate";
import { SecretBox } from "../src/settings/secret-box";
import { SettingsStore } from "../src/settings/store";

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
    default:
      console.error(
        "Usage: bun run settings export [--out file] | devices add <name> | devices list | devices revoke <id> | key show | rotate-key",
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

process.exit(await main());
