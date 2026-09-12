import { Body, Controller, Delete, Get, Put, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { toNumberArray } from '../../common/query.util';
import { UserVipService } from './uservip.service';

@Controller('uservip')
export class UserVipController {
  constructor(private readonly service: UserVipService) {}

  @Get('list')
  @RequirePermission('/api.v1.UserVipAPI/ListUserVip')
  list(@Query() query: any) {
    return this.service.list(query);
  }

  @Put()
  @RequirePermission('/api.v1.UserVipAPI/UpdateUserVip')
  update(@Body() body: any) {
    return this.service.update(body);
  }

  @Delete()
  @RequirePermission('/api.v1.UserVipAPI/DeleteUserVip')
  remove(@Query('id') id: unknown) {
    return this.service.remove(toNumberArray(id));
  }
}
