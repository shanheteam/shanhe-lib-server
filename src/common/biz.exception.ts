import { GRPC_CODE } from './grpc-code';

/**
 * 业务异常：携带 gRPC 风格的 code 与 message。
 * 由全局异常过滤器统一转换为 `{ code, message, details? }` 的 HTTP 响应。
 */
export class BizException extends Error {
  readonly code: number;
  readonly details?: unknown;

  constructor(code: number, message: string, details?: unknown) {
    super(message);
    this.name = 'BizException';
    this.code = code;
    this.details = details;
  }
}

// 常用快捷构造
export const Biz = {
  invalidArgument: (message: string) => new BizException(GRPC_CODE.INVALID_ARGUMENT, message),
  notFound: (message: string) => new BizException(GRPC_CODE.NOT_FOUND, message),
  alreadyExists: (message: string) => new BizException(GRPC_CODE.ALREADY_EXISTS, message),
  permissionDenied: (message: string) => new BizException(GRPC_CODE.PERMISSION_DENIED, message),
  unauthenticated: (message: string) => new BizException(GRPC_CODE.UNAUTHENTICATED, message),
  internal: (message: string) => new BizException(GRPC_CODE.INTERNAL, message),
};