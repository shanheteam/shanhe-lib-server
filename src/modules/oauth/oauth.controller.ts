import {
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtUser } from '../../auth/jwt-user.type';
import { OauthService } from './oauth.service';

@Controller('oauth')
export class OauthController {
  constructor(private readonly oauthService: OauthService) {}

  /**
   * Get enabled OAuth configs (public, used by login page)
   */
  @Public()
  @Get('configs')
  getConfigs() {
    return this.oauthService.getConfigs();
  }

  /**
   * OAuth login: exchange code for token, create/match user
   */
  @Public()
  @Post('login')
  login(@Body() body: any) {
    return this.oauthService.login(body);
  }

  /**
   * Password-grant login: lib submits email+password, provider verifies,
   * returns JWT for local user.
   */
  @Public()
  @Post('password-login')
  passwordLogin(@Body() body: any) {
    return this.oauthService.loginByPassword(body);
  }

  /**
   * Bind OAuth account to current logged-in user
   */
  @RequireLogin()
  @Post('bind')
  bind(@Body() body: any, @CurrentUser() user: JwtUser) {
    return this.oauthService.bind(body, user.userId);
  }
}
