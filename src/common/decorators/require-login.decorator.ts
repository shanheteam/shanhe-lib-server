import { SetMetadata } from '@nestjs/common';

export const REQUIRE_LOGIN_KEY = 'requireLogin';

/**
 * 标记接口需要登录（无需管理员权限）。
 */
export const RequireLogin = () => SetMetadata(REQUIRE_LOGIN_KEY, true);