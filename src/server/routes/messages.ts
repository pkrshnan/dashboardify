import { Hono } from "hono";
import type { IncomingMessage, Vault } from "../../vault/vault";
import type { AuthEnv } from "../auth";
import {
  type Body,
  badRequest,
  instant,
  MAX_ID_LENGTH,
  ok,
  optionalId,
  type Parsed,
  readBody,
  requiredText,
} from "../validate";

/** POST /ingest/messages: store a message that Siri has already triaged as important. */
export function messageRoutes(vault: Vault): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  routes.post("/", async (c) => {
    const message = parseMessage((await readBody(c.req.raw)) ?? {});
    if (!message.ok) {
      return badRequest(c, message.error);
    }
    return c.json(await vault.appendMessage(message.value), 201);
  });

  return routes;
}

function parseMessage(body: Body): Parsed<IncomingMessage> {
  const sender = requiredText(body.sender, "sender", MAX_ID_LENGTH);
  if (!sender.ok) {
    return sender;
  }
  const text = requiredText(body.text, "text");
  if (!text.ok) {
    return text;
  }
  const receivedAt = instant(body.received_at, "received_at");
  if (!receivedAt.ok) {
    return receivedAt;
  }
  return ok({
    id: optionalId(body.id),
    sender: sender.value,
    text: text.value,
    receivedAt: receivedAt.value,
  });
}
