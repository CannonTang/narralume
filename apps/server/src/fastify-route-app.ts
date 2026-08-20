import type {
  FastifyInstance,
  FastifyReply,
  RouteHandlerMethod,
} from "fastify";

import {
  normalizeRouteResult,
  type RouteApp,
  type RouteMethod,
  type RouteResponse,
} from "@narrative-lantern/services";

/**
 * RouteApp → Fastify 适配器：同一份 register*Routes 在 HTTP 宿主注册。
 * 处理器返回的 RouteResponse（含 Uint8Array body 与 headers）翻译成
 * reply.code/header/send。
 */
export function fastifyRouteApp(app: FastifyInstance): RouteApp {
  return {
    route(method, path, handler, options) {
      const routeHandler: RouteHandlerMethod = async (request, reply) => {
        const result = normalizeRouteResult(
          await handler({
            method,
            path: request.url.split("?")[0] ?? request.url,
            params: (request.params ?? {}) as Record<string, string>,
            query: (request.query ?? {}) as Record<string, unknown>,
            body: request.body,
            headers: request.headers as Record<string, string>,
            log: request.log,
          }),
        );
        applyRouteResponse(reply, result);
      };
      if (options?.bodyLimit !== undefined) {
        registerWith(
          app,
          method,
          path,
          { bodyLimit: options.bodyLimit },
          routeHandler,
        );
      } else {
        registerWith(app, method, path, undefined, routeHandler);
      }
    },
  };
}

function registerWith(
  app: FastifyInstance,
  method: RouteMethod,
  path: string,
  options: { bodyLimit: number } | undefined,
  handler: RouteHandlerMethod,
): void {
  const method_ = method.toLowerCase() as
    "get" | "post" | "put" | "patch" | "delete";
  if (options) {
    app[method_](path, options, handler);
  } else {
    app[method_](path, handler);
  }
}

function applyRouteResponse(reply: FastifyReply, result: RouteResponse): void {
  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) {
      reply.header(key, value);
    }
  }
  reply.code(result.status);
  reply.send(result.body);
}
