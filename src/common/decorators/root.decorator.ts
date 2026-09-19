import { SetMetadata } from '@nestjs/common';

/** 标记接口仅超级管理员（root）可访问 */
export const REQUIRE_ROOT_KEY = 'require_root';

/** 仅 root 可访问的接口装饰器（在 AuthGuard 中强制校验 userId === ROOT_USER_ID） */
export const RequireRoot = () => SetMetadata(REQUIRE_ROOT_KEY, true);