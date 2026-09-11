import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { PermissionService } from './permission.service';
import { JwtUser } from './jwt-user.type';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { REQUIRE_LOGIN_KEY } from '../common/decorators/require-login.decorator';
import { PERMISSION_KEY } from '../common/decorators/permission.decorator';
import { Biz } from '../common/biz.exception';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();

    // 解析 token（可选，不抛错）
    const authHeader = request.headers['authorization'] || '';
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) {
      const user = this.authService.verifyToken(token);
      if (user) request.user = user;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const grpcMethod = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (grpcMethod) {
      if (!request.user) throw Biz.unauthenticated('您未登录或您的登录已过期，请重新登录或刷新页面重试');
      const ok = await this.permissionService.check(request.user.userId, grpcMethod);
      if (!ok) throw Biz.permissionDenied(`您没有权限访问【${grpcMethod}】`);
      request.user.haveAccess = true;
      return true;
    }

    const requireLogin = this.reflector.getAllAndOverride<boolean>(REQUIRE_LOGIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requireLogin) {
      if (!request.user) throw Biz.unauthenticated('您未登录或您的登录已过期，请重新登录或刷新页面重试');
      return true;
    }

    return true;
  }
}