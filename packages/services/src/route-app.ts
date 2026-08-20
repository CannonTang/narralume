/**
 * 运行时无关的路由注册接口：同一份 register*Routes 代码在 Fastify
 * （HTTP）与浏览器内核（Worker RPC）双注册。HTTP 契约是唯一 API 面。
 *
 * 处理器收到的 request 是「已解析」的对象（body/params/query 为普通
 * JS 值），返回 RouteResponse（或裸 JSON 值 = 200）。二进制响应用
 * Uint8Array body + 显式 headers 表达。抛错走宿主的统一错误映射。
 */

export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteRequest {
  readonly method: RouteMethod;
  readonly path: string;
  /** 路径参数（:projectId 等），已解码。 */
  readonly params: Readonly<Record<string, string>>;
  /** 查询参数（URL 解析后的字典，值为 string 或 string[]）。 */
  readonly query: Record<string, unknown>;
  /** JSON body（DELETE 也允许）。 */
  readonly body: unknown;
  /** 请求头（小写键）。仅在 ETag 协商等少数端点使用。 */
  readonly headers: Readonly<Record<string, string>>;
  /** 结构化日志（内核侧可为 no-op）。 */
  readonly log: { warn(payload: unknown, message?: string): void };
}

export interface RouteResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

export type RouteHandler = (
  request: RouteRequest,
) => Promise<RouteResponse | unknown> | RouteResponse | unknown;

export interface RouteOptions {
  /** 请求体上限（字节）。Fastify 映射 bodyLimit；内核侧校验 JSON 大小。 */
  readonly bodyLimit?: number;
}

export interface RouteApp {
  route(
    method: RouteMethod,
    path: string,
    handler: RouteHandler,
    options?: RouteOptions,
  ): void;
}

/**
 * 处理器返回值归一：裸值 = 200 JSON；RouteResponse 原样。
 * 用于两个宿主适配器的公共出口。
 */
export function normalizeRouteResult(
  result: RouteResponse | unknown,
): RouteResponse {
  if (
    result !== null &&
    typeof result === "object" &&
    "status" in result &&
    typeof (result as RouteResponse).status === "number" &&
    ("body" in result ||
      "headers" in result ||
      (result as RouteResponse).body === undefined)
  ) {
    const response = result as RouteResponse;
    return {
      status: response.status,
      body: response.body,
      headers: response.headers,
    };
  }
  return { status: 200, body: result };
}
