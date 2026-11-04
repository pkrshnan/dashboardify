import { type DescMethod, type Message, toJson } from "@bufbuild/protobuf";
import type { Context, Hono } from "hono";
import type { AuthEnv } from "../auth";
import { ApiError } from "./errors";
import type { RestBinding } from "./rest-bindings";

type WireObject = Record<string, unknown>;
type Execute = (input: WireObject) => Promise<Message>;

/** Translate the HTTP annotation's path, query and body into an RPC request. */
export function registerRest(
  routes: Hono<AuthEnv>,
  method: DescMethod,
  execute: Execute,
  binding: RestBinding,
) {
  routes.on(binding.method, `/v1${binding.path}`, async (context) => {
    const body = await readBody(context, binding.method);
    const request: WireObject = Object.fromEntries(
      Object.entries(context.req.query()).map(([name, value]) => [camelCase(name), value]),
    );
    if (binding.bodyField) {
      request[binding.bodyField] = body;
    } else {
      Object.assign(request, body);
    }
    bindResourceName(context, request, body, binding);
    const response = await execute(request);
    return Response.json(toJson(method.output, response));
  });
}
async function readBody(context: Context<AuthEnv>, method: string): Promise<WireObject> {
  if (!["POST", "PATCH"].includes(method)) {
    return {};
  }
  const body: unknown = await context.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "JSON object required");
  }
  return body as WireObject;
}

function bindResourceName(
  context: Context<AuthEnv>,
  request: WireObject,
  body: WireObject,
  binding: RestBinding,
) {
  const resource = binding.resource;
  if (!resource) {
    return;
  }
  let name = resource.prefix;
  if (name !== "home") {
    name += context.req.param("id")?.split(":")[0] ?? context.req.param("day");
  }
  name += resource.suffix ?? "";
  if (resource.field.endsWith(".name")) {
    if (body.name && body.name !== name) {
      throw new ApiError(400, "resource name does not match path");
    }
    body.name = name;
    return;
  }
  request[resource.field] = name;
}

function camelCase(name: string) {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
