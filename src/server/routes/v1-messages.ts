import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { shortHash } from "../../vault/task-store";
import type { Vault } from "../../vault/vault";

/** Read legacy message notes too, so switching endpoints preserves history. */
export async function legacyMessages(vault: Vault) {
  let files: string[];
  try {
    files = await readdir(join(vault.root, "inbox/messages"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const messages = [];
  for (const file of files.filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))) {
    const source = (await vault.read(`inbox/messages/${file}`)) ?? "";
    for (const match of source.matchAll(
      /^- (\d{2}:\d{2}) \*\*(.*?)\*\*: (.*?)(?: <!-- id:(.*?) -->)?$/gm,
    )) {
      const [, time, sender = "", text = "", id] = match;
      const receiveTime = Temporal.PlainDateTime.from(`${file.slice(0, 10)}T${time}`)
        .toZonedDateTime(vault.timeZone)
        .toInstant()
        .toString();
      messages.push({
        name: `messages/${id || shortHash(`${file}:${match.index}`)}`,
        sender: sender.replace(/\\([*_`[\]])/g, "$1"),
        text,
        receiveTime,
      });
    }
  }
  return messages;
}
