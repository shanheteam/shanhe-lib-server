import {
  Controller,
  Delete,
  Get,
  Query,
} from '@nestjs/common';
import { SearchRecordService } from './searchrecord.service';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { toNumberArray } from '../../common/query.util';

@Controller('searchrecord')
export class SearchRecordController {
  constructor(private readonly service: SearchRecordService) {}

  @Delete()
  @RequirePermission('/api.v1.SearchRecordAPI/DeleteSearchRecord')
  async remove(@Query('id') id: unknown) {
    await this.service.remove(toNumberArray(id));
    return {};
  }

  @Get('list')
  @RequirePermission('/api.v1.SearchRecordAPI/ListSearchRecord')
  list(@Query() query: any) {
    return this.service.list(query);
  }
}