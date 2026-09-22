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
import { REQUIRE_ROOT_KEY } from '../common/decorators/root.decorator';
import { ROOT_USER_ID } from '../common/root-user.constant';
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

    const requireRoot = this.reflector.getAllAndOverride<boolean>(REQUIRE_ROOT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requireRoot) {
      if (!request.user) throw Biz.unauthenticated('您未登录或您的登录已过期，请重新登录或刷新页面重试');
      if (request.user.userId !== ROOT_USER_ID) {
        throw Biz.permissionDenied('该操作仅超级管理员可执行');
      }
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

    // 默认策略：拒绝优先。未显式声明 @Public() 且不满足任何鉴权装饰器的路由，
    // 一律要求登录，避免新增 endpoint 漏标而被静默公开。
    if (!request.user) throw Biz.unauthenticated('您未登录或您的登录已过期，请重新登录或刷新页面重试');
    return true;
  }
}