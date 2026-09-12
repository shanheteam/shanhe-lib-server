import { Body, Controller, Delete, Get, Post, Put, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { toNumberArray } from '../../common/query.util';
import { SpiderUrlService } from './spider-url.service';

@Controller('spiderurl')
export class SpiderUrlController {
  constructor(private readonly service: SpiderUrlService) {}

  @Post()
  @RequirePermission('/api.v1.SpiderAPI/CreateSpiderUrl')
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Put()
  @RequirePermission('/api.v1.SpiderAPI/UpdateSpiderUrl')
  update(@Body() body: any) {
    return this.service.update(body);
  }

  @Delete()
  @RequirePermission('/api.v1.SpiderAPI/DeleteSpiderUrl')
  remove(@Query('id') id: unknown) {
    return this.service.remove(toNumberArray(id));
  }

  @Get('list')
  @RequirePermission('/api.v1.SpiderAPI/ListSpiderUrl')
  list(@Query() query: any) {
    return this.service.list(query);
  }

  @Get()
  @RequirePermission('/api.v1.SpiderAPI/GetSpiderUrl')
  get(@Query('id') id: string) {
    return this.service.get(Number(id));
  }

  @Put('status')
  @RequirePermission('/api.v1.SpiderAPI/UpdateSpiderUrlStatus')
  setStatus(@Body() body: { id?: unknown; status?: number }) {
    return this.service.setStatus(toNumberArray(body?.id), Number(body?.status));
  }
}
