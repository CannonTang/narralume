/**
 * 服务层领域错误：code 供 API 消费方编程判断，statusCode 由 HTTP 层翻译。
 * 服务层不认识 Fastify；这里保留状态码是路由错误形状的延续，避免
 * app.ts 错误映射的 25 个分支再各配一张表。
 */
export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
