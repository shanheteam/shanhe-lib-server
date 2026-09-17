import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { Biz } from './biz.exception';

/**
 * 限流守卫：沿用 ThrottlerGuard 的计数逻辑，仅把默认的英文 429 响应
 * 替换为项目统一的业务异常结构（HTTP 429 + 中文提示）。
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    _context: ExecutionContext,
    _detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw Biz.resourceExhausted('操作过于频繁，请稍后再试');
  }
}