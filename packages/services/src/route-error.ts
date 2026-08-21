import {
  AutomationServiceError,
  RunServiceError,
  StudioServiceError,
} from "@narralume/services";

/**
 * 路由层领域错误：与共享服务层的 RunServiceError 同构，继承它使得
 * app.ts 的错误映射一个 instanceof 分支同时覆盖两层抛出的错误。
 */
export class RunRouteError extends RunServiceError {
  constructor(code: string, message: string, statusCode: number) {
    super(code, message, statusCode);
    this.name = "RunRouteError";
  }
}

/** studio 路由域错误：与 StudioServiceError 同构。 */
export class StudioRouteError extends StudioServiceError {
  constructor(code: string, message: string, statusCode: number) {
    super(code, message, statusCode);
    this.name = "StudioRouteError";
  }
}

/** automation 路由域错误：与 AutomationServiceError 同构。 */
export class AutomationRouteError extends AutomationServiceError {
  constructor(code: string, message: string, statusCode: number) {
    super(code, message, statusCode);
    this.name = "AutomationRouteError";
  }
}
