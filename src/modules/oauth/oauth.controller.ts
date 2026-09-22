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
  login(@Body() body: any, @Req() req: Request) {
    return this.oauthService.login(body, req.ip);
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
    const ret: any = await this.oauthService.passwordLogin(body, req.ip);
    // Cookie 真源 SSO：把 user-center 的 access_token 与 refresh_token 写进 .shanhe.co 共享 cookie，
    // 使 user-center 侧（及其他同域子站）能识别该用户已登录，并借同一父域 refresh_token 长期续期。
    if (ret?.uc_access_token) {
      this.setSharedAccessTokenCookie(req, res, String(ret.uc_access_token));
      delete ret.uc_access_token; // 不把 user-center token 泄露给前端
    }
    if (ret?.uc_refresh_token) {
      this.setSharedRefreshTokenCookie(req, res, String(ret.uc_refresh_token));
      delete ret.uc_refresh_token;
    }
    return ret;
  }

  /**
   * 注册：转发到 user 统一认证中心（内联注册表单使用）。
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @Post('register')
  register(@Body() body: any, @Req() req: Request) {
    return this.oauthService.register(body, req.ip);
  }

  /**
   * 获取随机学号：GET ucBase/users/meta/available-student-id?year=2027 → { student_id }。
   */
  @Public()
  @Get('available-student-id')
  availableStudentId(@Req() req: Request) {
    return this.oauthService.availableStudentId(req.ip);
  }

  /**
   * 静默建立 lib 会话：浏览器带着 .shanhe.co 共享 access_token cookie 时，
   * 校验 user-center 身份并经 UserOauth 绑定签发 lib token（user-center 登录 → lib 自动登录）。
   * 若 access_token 已过期，后端会经 user-center 静默续期并把新令牌回写共享父域 cookie（全站长在线）。
   */
  @Public()
  @Post('sso')
  async sso(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ret: any = await this.oauthService.ssoSession(req);
    this.writeSharedRefreshCookies(req, res, ret);
    return ret;
  }

  /**
   * SSO 会话探测：用于 user-center 登出后 lib 后台静默退出（探测共享 cookie 是否仍有效），
   * 同时承载 access_token 续期后把新令牌回写共享父域 cookie 的职责。
   */
  @Public()
  @Get('sso/session')
  @Header('Cache-Control', 'no-store')
  async ssoSessionProbe(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ret: any = await this.oauthService.ssoSession(req);
    this.writeSharedRefreshCookies(req, res, ret);
    return ret;
  }

  /**
   * 续期结果回写父域 cookie：仅当后端做了静默续期（ssoSession 返回 refresh）时，
   * 把新 access_token 与新 refresh_token（轮换后）落到 .shanhe.co。
   * 原始令牌只用于写 cookie，绝不返回给前端（delete ret.refresh）。
   */
  private writeSharedRefreshCookies(req: Request, res: Response, ret: any): void {
    const refresh = ret?.refresh;
    if (!refresh?.access_token) return;
    this.setSharedAccessTokenCookie(req, res, String(refresh.access_token));
    if (refresh.refresh_token) {
      this.setSharedRefreshTokenCookie(req, res, String(refresh.refresh_token));
    }
    delete ret.refresh;
  }

  /**
   * SSO 共享 cookie 清除：lib 无法跳转 user-center 登出端点时（如授权地址配置异常），
   * 由 lib 后端直接下发 Set-Cookie 清掉 .shanhe.co 域的 access_token，
   * 避免刷新后 SSO 静默探测把已登出的会话"带回来"（退出无效）。
   */
  @Public()
  @Post('sso/logout')
  ssoLogout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const isProd = process.env.NODE_ENV === 'production';
    const domain = this.sharedCookieDomain(req);
    const secure = isProd ? '; Secure' : '';
    const domainAttr = domain ? `; Domain=${domain}` : '';
    res.setHeader('Set-Cookie', [
      `access_token=; Path=/; HttpOnly; SameSite=Lax${domainAttr}${secure}; Max-Age=0`,
      `refresh_token=; Path=/; HttpOnly; SameSite=Lax${domainAttr}${secure}; Max-Age=0`,
    ]);
    return { ok: true };
  }

  /** 写 user-center 共享 cookie 的通用工具：把 user-center access_token 落在 .shanhe.co 域。 */
  private setSharedAccessTokenCookie(req: Request, res: Response, token: string): void {
    const isProd = process.env.NODE_ENV === 'production';
    const domain = this.sharedCookieDomain(req);
    const secure = isProd ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `access_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${domain ? `; Domain=${domain}` : ''}${secure}; Max-Age=3600`,
    );
  }

  /** 写 user-center 共享 refresh_token cookie 的工具：轮换后把新 refresh_token 也落到 .shanhe.co。 */
  private setSharedRefreshTokenCookie(req: Request, res: Response, token: string): void {
    const isProd = process.env.NODE_ENV === 'production';
    const domain = this.sharedCookieDomain(req);
    const secure = isProd ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `refresh_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${domain ? `; Domain=${domain}` : ''}${secure}; Max-Age=${30 * 24 * 60 * 60}`,
    );
  }

  /**
   * 从请求推导 .shanhe.co 共享父域：lib.shanhe.co → .shanhe.co；localhost/127.0.0.1 无 Domain（仅本机）。
   * 优先取 Host 头（剥离端口），与 user-center cookies.js 的 resolveSharedCookieDomain 取法一致，
   * 避免 trust proxy 场景下 req.hostname 误判为内部主机名，导致共享 cookie 写成 host-only 而无法跨子站读取。
   */
  private sharedCookieDomain(req: Request): string {
    const hostHeader = String(req.headers['host'] || '').trim();
    const splitIdx = hostHeader.indexOf(':');
    const host = (splitIdx > -1 ? hostHeader.slice(0, splitIdx) : hostHeader).toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return '';
    const parts = host.split('.');
    if (!/\.co$/.test(host) || parts.length < 3) return '';
    return '.' + parts.slice(-2).join('.');
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
