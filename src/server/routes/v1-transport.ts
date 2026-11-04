import {
  type DescMethod,
  type DescMethodUnary,
  type DescService,
  fromJson,
  type JsonValue,
  type Message,
  toJson,
} from "@bufbuild/protobuf";
import { Code, ConnectError, createConnectRouter } from "@connectrpc/connect";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { defined } from "../../defined";
import { DayService } from "../../gen/dashboardify/v1/day_pb";
import { HomeService } from "../../gen/dashboardify/v1/home_pb";
import { JournalService } from "../../gen/dashboardify/v1/journal_pb";
import { MessageService } from "../../gen/dashboardify/v1/message_pb";
import { SampleService } from "../../gen/dashboardify/v1/sample_pb";
import { TaskService } from "../../gen/dashboardify/v1/task_pb";
import { VoiceService } from "../../gen/dashboardify/v1/voice_pb";
import type { AuthEnv } from "../auth";
import { ApiError, type Json } from "./v1";

const bindings: Record<string, [string, string, string?, string?]> = {
  getTask: ["get", "/tasks/:id", "name", "tasks/"],
  listTasks: ["get", "/tasks"],
  createTask: ["post", "/tasks", "task"],
  updateTask: ["patch", "/tasks/:id", "task", "tasks/"],
  deleteTask: ["delete", "/tasks/:id", "name", "tasks/"],
  completeTask: ["post", "/tasks/:id{[a-zA-Z0-9_-]+:complete}", "name", "tasks/"],
  reopenTask: ["post", "/tasks/:id{[a-zA-Z0-9_-]+:reopen}", "name", "tasks/"],
  searchTasks: ["get", "/tasks:search"],
  getDay: ["get", "/days/:day", "name", "days/"],
  getCheckin: ["get", "/days/:day/checkin", "name", "days/"],
  updateCheckin: ["patch", "/days/:day/checkin", "checkin", "days/"],
  createJournalEntry: ["post", "/days/:day/journalEntries", "journalEntry", "days/"],
  listJournalEntries: ["get", "/days/:day/journalEntries", "parent", "days/"],
  createMessage: ["post", "/messages", "message"],
  listMessages: ["get", "/messages"],
  getStream: ["get", "/streams/:id", "name", "streams/"],
  listStreams: ["get", "/streams"],
  mergeSamples: ["post", "/streams/:id{[a-zA-Z0-9_-]+:mergeSamples}", "stream", "streams/"],
  getHome: ["get", "/home", "name", "home"],
};
type Execute = (input: Json) => Promise<Message>;
type Handlers = Record<string, (q: Json) => Promise<Json>>;
type Binding = [string, string, string?, string?];
const services: DescService[] = [
  TaskService,
  DayService,
  JournalService,
  MessageService,
  SampleService,
  HomeService,
  VoiceService,
];
function errorStatus(error: Error) {
  if (error instanceof ApiError) {
    return error.status;
  }
  return ({ NOT_FOUND: 404, ABORTED: 409 } as Record<string, number>)[error.message] ?? 500;
}
function connectFailure(error: unknown) {
  const failure = error instanceof Error ? error : new Error(String(error));
  const status = errorStatus(failure);
  if (failure.message === "message already exists") {
    return new ConnectError(failure.message, Code.AlreadyExists);
  }
  const code =
    ({ 400: Code.InvalidArgument, 404: Code.NotFound, 409: Code.Aborted } as Record<number, Code>)[
      status
    ] ?? Code.Internal;
  return new ConnectError(status === 500 ? "internal error" : failure.message, code);
}
function executor(method: DescMethod, handlers: Handlers): Execute {
  return async (input) => {
    let parsed: Message;
    try {
      parsed = fromJson(method.input, input as JsonValue);
    } catch (error) {
      throw new ApiError(400, String(error));
    }
    const normalized: Json = { ...input, ...(toJson(method.input, parsed) as Json) };
    for (const key of ["task", "checkin"]) {
      if (input[key]) {
        normalized[key] = { ...input[key], ...normalized[key] };
      }
    }
    const result = await defined(handlers[method.localName])(normalized);
    return fromJson(method.output, JSON.parse(JSON.stringify(result)));
  };
}
async function restBody(c: Context<AuthEnv>, verb: string): Promise<Json> {
  if (!["post", "patch"].includes(verb)) {
    return {};
  }
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "JSON object required");
  }
  return body as Json;
}
function bindResource(c: Context<AuthEnv>, q: Json, body: Json, binding: Binding) {
  const [, path, field, prefix] = binding;
  if (!prefix) {
    return;
  }
  let value = prefix;
  if (prefix !== "home") {
    value += c.req.param("id")?.split(":")[0] ?? c.req.param("day");
  }
  if (path.endsWith("checkin")) {
    value += "/checkin";
  }
  if (field === "task" || field === "checkin") {
    if (body.name && body.name !== value) {
      throw new ApiError(400, "resource name does not match path");
    }
    q[field].name = value;
    return;
  }
  q[field === "journalEntry" ? "parent" : defined(field)] = value;
}
function registerRest(
  routes: Hono<AuthEnv>,
  method: DescMethod,
  execute: Execute,
  binding: Binding,
) {
  const [verb, path, field] = binding;
  routes.on(verb.toUpperCase(), `/v1${path}`, async (c) => {
    const body = await restBody(c, verb);
    const q: Json = Object.fromEntries(
      Object.entries(c.req.query()).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, s: string) => s.toUpperCase()),
        v,
      ]),
    );
    if (field && ["task", "checkin", "message", "journalEntry"].includes(field)) {
      q[field] = body;
    } else {
      Object.assign(q, body);
    }
    bindResource(c, q, body, binding);
    return Response.json(toJson(method.output, await execute(q)));
  });
}
function responseStream(source: AsyncIterable<Uint8Array> | undefined) {
  const iterator = source?.[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator?.next();
      if (!next || next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel() {
      await iterator?.return?.();
    },
  });
}
export function v1Transport(handlers: Handlers) {
  const routes = new Hono<AuthEnv>();
  const connect = createConnectRouter({
    grpc: false,
    grpcWeb: false,
    readMaxBytes: 64 * 1024 * 1024,
    jsonOptions: { ignoreUnknownFields: false },
  });
  routes.use("*", bodyLimit({ maxSize: 64 * 1024 * 1024 }));
  routes.onError((error, c) => {
    const status = errorStatus(error);
    if (status === 500) {
      console.error(error);
    }
    const code =
      ({ 400: "invalid_argument", 404: "not_found", 409: "aborted" } as Record<number, string>)[
        status
      ] ?? "internal";
    return c.json(
      { code, message: status === 500 ? "internal error" : error.message },
      status as 400,
    );
  });
  for (const service of services) {
    for (const method of [...service.methods].sort(
      (a, b) => Number(b.name === "SearchTasks") - Number(a.name === "SearchTasks"),
    )) {
      const execute = executor(method, handlers);
      connect.rpc(method as DescMethodUnary, async (request) => {
        try {
          return await execute(toJson(method.input, request) as Json);
        } catch (error) {
          throw connectFailure(error);
        }
      });
      const binding = bindings[method.localName];
      if (binding) {
        registerRest(routes, method, execute, binding);
      }
    }
  }
  mountConnect(routes, connect);
  return routes;
}

function mountConnect(routes: Hono<AuthEnv>, connect: ReturnType<typeof createConnectRouter>) {
  for (const handler of connect.handlers) {
    routes.on(handler.allowedMethods, handler.requestPath, async (c) => {
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const response = await handler({
        httpVersion: "1.1",
        url: c.req.url,
        method: c.req.method,
        header: c.req.raw.headers,
        signal: c.req.raw.signal,
        body: (async function* () {
          yield bytes;
        })(),
      });
      return new Response(responseStream(response.body), {
        status: response.status,
        headers: response.header,
      });
    });
  }
}
