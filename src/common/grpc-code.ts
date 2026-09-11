// gRPC -> HTTP 状态码映射（与原版 grpc-gateway 行为保持一致）
export const GRPC_CODE = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  UNAUTHENTICATED: 16,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
} as const;

export function grpcCodeToHttp(code: number): number {
  switch (code) {
    case GRPC_CODE.OK:
      return 200;
    case GRPC_CODE.INVALID_ARGUMENT:
    case GRPC_CODE.FAILED_PRECONDITION:
    case GRPC_CODE.OUT_OF_RANGE:
      return 400;
    case GRPC_CODE.UNAUTHENTICATED:
      return 401;
    case GRPC_CODE.PERMISSION_DENIED:
      return 403;
    case GRPC_CODE.NOT_FOUND:
      return 404;
    case GRPC_CODE.ALREADY_EXISTS:
    case GRPC_CODE.ABORTED:
      return 409;
    case GRPC_CODE.RESOURCE_EXHAUSTED:
      return 429;
    case GRPC_CODE.UNIMPLEMENTED:
      return 501;
    case GRPC_CODE.UNAVAILABLE:
      return 503;
    case GRPC_CODE.INTERNAL:
    default:
      return 500;
  }
}