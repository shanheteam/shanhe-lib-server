import {
  Controller,
  Delete,
  Get,
  Query,
} from '@nestjs/common';
import { SearchRecordService } from './searchrecord.service';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
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
  @RequireLogin()
  list(@Query() query: any) {
    return this.service.list(query);
  }
}