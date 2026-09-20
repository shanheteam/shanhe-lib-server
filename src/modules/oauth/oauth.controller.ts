import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Throttle } from '@nestjs/throttler';
import { JwtUser } from '../../auth/jwt-user.type';
import { OauthService } from './oauth.service';

@Controller('oauth')
export class OauthController {
  constructor(private readonly oauthService: OauthService) {}

  /**
   * Get enabled OAuth configs (public, used by login page).
   * 配置类接口禁止缓存，避免浏览器/CDN 缓存到陈旧的授权地址等配置。
   */
  @Public()
  @Get('configs')
  @Header('Cache-Control', 'no-store')
  getConfigs() {
    return this.oauthService.getConfigs();
  }

  /**
   * OAuth login: exchange code for token, create/match user
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Public()
  @Post('login')
  login(@Body() body: any) {
    return this.oauthService.login(body);
  }

  /**
   * 直接登录：用 user-center 账号密码换 token，不经过授权页。
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @Post('password-login')
  async passwordLogin(
    @Body() body: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ret: any = await this.oauthService.passwordLogin(body);
    // Cookie 真源 SSO：把 user-center 的 access_token 写进 .shanhe.co 共享 cookie，
    // 使 user-center 侧（及其他同域子站）能识别该用户已登录。
    if (ret?.uc_access_token) {
      this.setSharedAccessTokenCookie(req, res, String(ret.uc_access_token));
      delete ret.uc_access_token; // 不把 user-center token 泄露给前端
    }
    return ret;
  }

  /**
   * 静默建立 lib 会话：浏览器带着 .shanhe.co 共享 access_token cookie 时，
   * 校验 user-center 身份并经 UserOauth 绑定签发 lib token（user-center 登录 → lib 自动登录）。
   */
  @Public()
  @Post('sso')
  sso(@Req() req: Request) {
    return this.oauthService.ssoSession(req);
  }

  /**
   * SSO 会话探测：用于 user-center 登出后 lib 后台静默退出（探测共享 cookie 是否仍有效）。
   */
  @Public()
  @Get('sso/session')
  @Header('Cache-Control', 'no-store')
  ssoSessionProbe(@Req() req: Request) {
    return this.oauthService.ssoSession(req);
  }

  /** 写 user-center 共享 cookie 的通用工具：把 user-center access_token 落在 .shanhe.co 域。 */
  private setSharedAccessTokenCookie(req: Request, res: Response, token: string): void {
    const isProd = process.env.NODE_ENV === 'production';
    // 从请求域名推导共享父域：lib.shanhe.co → shanhe.co；localhost 则无 domain（仅本机）
    const host = (req.hostname || '').toLowerCase();
    const parts = host.split('.');
    let domain = '';
    if (/\.co$/.test(host) && parts.length >= 3) domain = '.' + parts.slice(-2).join('.');
    const secure = isProd ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `access_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${domain ? `; Domain=${domain}` : ''}${secure}; Max-Age=3600`,
    );
  }

  /**
   * Bind OAuth account to current logged-in user
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequireLogin()
  @Post('bind')
  bind(@Body() body: any, @CurrentUser() user: JwtUser) {
    return this.oauthService.bind(body, user.userId);
  }
}
