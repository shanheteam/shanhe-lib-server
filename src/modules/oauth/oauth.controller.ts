import {
  Body,
  Controller,
  Get,
  Header,
  Post,
} from '@nestjs/common';
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
  passwordLogin(@Body() body: any) {
    return this.oauthService.passwordLogin(body);
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
