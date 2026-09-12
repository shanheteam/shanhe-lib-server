import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ReportService } from './report.service';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtUser } from '../../auth/jwt-user.type';
import { toNumberArray } from '../../common/query.util';

@Controller('report')
export class ReportController {
  constructor(private readonly service: ReportService) {}

  @Post()
  @RequireLogin()
  async create(@Body() body: any, @CurrentUser() user: JwtUser) {
    await this.service.create(body, user?.userId ?? 0);
    return {};
  }

  @Put()
  @RequirePermission('/api.v1.ReportAPI/UpdateReport')
  async update(@Body() body: any) {
    await this.service.update(body);
    return {};
  }

  @Delete()
  @RequirePermission('/api.v1.ReportAPI/DeleteReport')
  async remove(@Query('id') id: unknown) {
    await this.service.remove(toNumberArray(id));
    return {};
  }

  @Get('list')
  @RequirePermission('/api.v1.ReportAPI/ListReport')
  list(@Query() query: any) {
    return this.service.list(query);
  }
}