import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 标记接口为公开接口（跳过登录校验）。
 * 默认所有接口都需要登录；被 @Public 标记的接口跳过 JwtAuthGuard。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);