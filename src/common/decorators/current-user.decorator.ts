import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtUser } from '../../auth/jwt-user.type';

/**
 * 从请求中提取当前登录用户（由 JwtAuthGuard 解析并挂载）。
 * 未登录时返回 undefined。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);