import {
  type DescMethod,
  type DescMethodUnary,
  fromJson,
  type JsonValue,
  type Message,
  toJson,
} from "@bufbuild/protobuf";
import { Code, ConnectError, createConnectRouter } from "@connectrpc/connect";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { defined } from "../../defined";
import { ApiError } from "../api/errors";
import { registerRest } from "../api/rest";
import { restBindings } from "../api/rest-bindings";

import type { AuthEnv } from "../auth";
import type { ServiceRegistration } from "./v1";

type Json = Record<string, unknown>;

type Execute = (input: Json) => Promise<Message>;
type Handler = (input: unknown) => Promise<unknown>;

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
function executor(method: DescMethod, handler: Handler): Execute {
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
        normalized[key] = { ...(input[key] as Json), ...(normalized[key] as Json) };
      }
    }
    const result = await handler(normalized);
    return fromJson(method.output, JSON.parse(JSON.stringify(result)));
  };
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
export function v1Transport(registrations: ServiceRegistration[]) {
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
  for (const { schema: service, implementation } of registrations) {
    for (const method of service.methods) {
      // The generated descriptor validates the wire input before calling a typed service method.
      const handler = (implementation as Record<string, Handler>)[method.localName];
      const execute = executor(method, defined(handler));
      connect.rpc(method as DescMethodUnary, async (request) => {
        try {
          return await execute(toJson(method.input, request) as Json);
        } catch (error) {
          throw connectFailure(error);
        }
      });
      const binding = restBindings[method.localName];
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
