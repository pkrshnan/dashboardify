import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { defined } from "../../defined";
import type { Vault } from "../../vault/vault";
import { legacyMessages } from "../routes/v1-messages";
import { ApiError, invalidArgument, requireText } from "./errors";
import { filterItems } from "./filter";
import { paginate } from "./pagination";
import type { ApiRequests } from "./requests";
/** Stores local message resources and includes legacy Markdown history. */
export class MessagesService {
  constructor(private readonly vault: Vault) {}

  createMessage = async (request: ApiRequests["createMessage"]) => {
    const message = request.message ?? {};
    const receiveTime = new Date(message.receiveTime);
    if (Number.isNaN(receiveTime.getTime())) {
      invalidArgument("receive_time is required");
    }
    const id = request.messageId || randomUUID();
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
      invalidArgument("invalid message id");
    }
    const value = {
      name: `messages/${id}`,
      sender: requireText(message.sender),
      text: requireText(message.text),
      receiveTime: receiveTime.toISOString(),
    };
    let exists = false;
    await this.vault.update(`inbox/messages/v1/${id}.json`, (old) => {
      if (old) {
        exists = true;
        return null;
      }
      return JSON.stringify(value);
    });
    if (exists) {
      throw new ApiError(409, "message already exists");
    }
    await this.vault.appendMessage({
      id,
      sender: value.sender,
      text: value.text,
      receivedAt: receiveTime,
    });
    return value;
  };

  listMessages = async (request: ApiRequests["listMessages"]) => {
    let files: string[] = [];
    try {
      files = await readdir(join(this.vault.root, "inbox/messages/v1"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const storedMessages = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(
          async (file) =>
            JSON.parse(
              defined(await this.vault.read(`inbox/messages/v1/${file}`)),
            ) as MessageResource,
        ),
    );
    const knownNames = new Set(storedMessages.map((message) => message.name));
    storedMessages.push(
      ...(await legacyMessages(this.vault)).filter((message) => !knownNames.has(message.name)),
    );
    const rows = filterItems(
      storedMessages.map((message) => ({ ...message, receive_time: message.receiveTime })),
      request.filter,
      ["sender", "receive_time"],
    );
    rows.sort(
      (left, right) =>
        right.receiveTime.localeCompare(left.receiveTime) || left.name.localeCompare(right.name),
    );
    const resultPage = paginate(rows, request);
    return {
      messages: resultPage.items.map(({ receive_time, ...message }) => message),
      nextPageToken: resultPage.nextPageToken,
    };
  };
}

interface MessageResource {
  name: string;
  sender: string;
  text: string;
  receiveTime: string;
}
