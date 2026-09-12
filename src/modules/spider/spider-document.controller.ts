import { Body, Controller, Delete, Get, Put, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { toNumberArray } from '../../common/query.util';
import { SpiderDocumentService } from './spider-document.service';

@Controller('spiderdocument')
export class SpiderDocumentController {
  constructor(private readonly service: SpiderDocumentService) {}

  @Get('list')
  @RequirePermission('/api.v1.SpiderAPI/ListSpiderDocument')
  list(@Query() query: any) {
    return this.service.list(query);
  }

  @Get()
  @RequirePermission('/api.v1.SpiderAPI/GetSpiderDocument')
  get(@Query('id') id: string) {
    return this.service.get(Number(id));
  }

  @Put()
  @RequirePermission('/api.v1.SpiderAPI/UpdateSpiderDocument')
  update(@Body('spider_document') data: any, @Body() body: any) {
    return this.service.update(data ?? body ?? {});
  }

  @Put('batch')
  @RequirePermission('/api.v1.SpiderAPI/BatchUpdateSpiderDocument')
  batch(@Body('spider_document') items: any[]) {
    return this.service.batch(items);
  }

  @Delete()
  @RequirePermission('/api.v1.SpiderAPI/DeleteSpiderDocument')
  remove(@Query('id') id: unknown) {
    return this.service.remove(toNumberArray(id));
  }
}
