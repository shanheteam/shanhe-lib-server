import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PunishmentService } from './punishment.service';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtUser } from '../../auth/jwt-user.type';
import { toNumberArray } from '../../common/query.util';

@Controller('punishment')
export class PunishmentController {
  constructor(private readonly service: PunishmentService) {}

  @Post()
  @RequirePermission('/api.v1.PunishmentAPI/CreatePunishment')
  async create(@Body() body: any, @CurrentUser() user: JwtUser) {
    await this.service.create(body, user?.userId ?? 0);
    return {};
  }

  @Put()
  @RequirePermission('/api.v1.PunishmentAPI/UpdatePunishment')
  async update(@Body() body: any, @CurrentUser() user: JwtUser) {
    await this.service.update(body, user?.userId ?? 0);
    return {};
  }

  @Put('cancel')
  @RequirePermission('/api.v1.PunishmentAPI/CancelPunishment')
  async cancel(@Body() body: any, @CurrentUser() user: JwtUser) {
    await this.service.cancel(toNumberArray(body?.id), user?.userId ?? 0);
    return {};
  }

  @Get()
  @RequirePermission('/api.v1.PunishmentAPI/GetPunishment')
  get(@Query('id') id: string) {
    return this.service.get(Number(id));
  }

  @Get('list')
  @RequirePermission('/api.v1.PunishmentAPI/ListPunishment')
  list(@Query() query: any) {
    return this.service.list(query);
  }
}