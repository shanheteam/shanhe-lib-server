import { Controller, Get, Query } from '@nestjs/common';
import { DynamicService } from './dynamic.service';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtUser } from '../../auth/jwt-user.type';

@Controller('dynamic')
export class DynamicController {
  constructor(private readonly service: DynamicService) {}

  @Get('list')
  @RequireLogin()
  list(@Query() query: any, @CurrentUser() user: JwtUser) {
    return this.service.list(user?.userId ?? 0, query);
  }
}