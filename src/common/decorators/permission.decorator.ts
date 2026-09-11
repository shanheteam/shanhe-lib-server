import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';

/**
 * 标记接口需要管理员权限，权限项为 gRPC full method（如 `/api.v1.UserAPI/AddUser`）。
 * 与权限种子数据中的 path/method(GRPC) 一一对应。
 */
export const RequirePermission = (grpcMethod: string) =>
  SetMetadata(PERMISSION_KEY, grpcMethod);