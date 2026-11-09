import { type DescMethod, type Message, ScalarType, toJson } from "@bufbuild/protobuf";
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
    const request = fromQuery(method, context.req.query());
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
  // A path with no parameter names a singleton, such as `home` or `settings`.
  if (binding.path.includes("/:")) {
    name += pathId(context);
  }
  if (resource.nested) {
    name += `/${resource.nested}/${context.req.param("child")}`;
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

/** The resource's id from the path: `{id}`, or `{day}` and its `{workout}`, less any `:verb`. */
function pathId(context: Context<AuthEnv>): string {
  const id = context.req.param("id")?.split(":")[0];
  if (id) {
    return id;
  }
  const workout = context.req.param("workout")?.split(":")[0];
  return `${context.req.param("day")}${workout ? `/workouts/${workout}` : ""}`;
}

/** Query parameters as request fields. A dotted name such as `start_date.year` sets a field of a
 * message field, as in Google's HTTP transcoding. */
function fromQuery(method: DescMethod, query: Record<string, string>): WireObject {
  const request: WireObject = {};
  for (const [name, value] of Object.entries(query)) {
    const path = name.split(".").map(camelCase);
    const last = path.pop() ?? name;
    let target = request;
    for (const key of path) {
      target[key] = typeof target[key] === "object" && target[key] !== null ? target[key] : {};
      target = target[key] as WireObject;
    }
    target[last] = path.length > 0 ? value : queryValue(method, last, value);
  }
  return request;
}

/** Query strings are text; a boolean field needs `true` or `false` as JSON. */
function queryValue(method: DescMethod, name: string, value: string): unknown {
  const field = method.input.fields.find((f) => f.jsonName === name);
  const isBool = field?.fieldKind === "scalar" && field.scalar === ScalarType.BOOL;
  if (isBool && (value === "true" || value === "false")) {
    return value === "true";
  }
  return value;
}

function camelCase(name: string) {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
