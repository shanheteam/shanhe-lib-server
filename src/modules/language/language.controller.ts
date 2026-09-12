import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { LanguageService } from './language.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { toNumberArray } from '../../common/query.util';

@Controller('language')
export class LanguageController {
  constructor(private readonly service: LanguageService) {}

  @Post()
  @RequirePermission('/api.v1.LanguageAPI/CreateLanguage')
  async create(@Body() body: any) {
    await this.service.create(body);
    return {};
  }

  @Put()
  @RequirePermission('/api.v1.LanguageAPI/UpdateLanguage')
  async update(@Body() body: any) {
    await this.service.update(body);
    return {};
  }

  @Put('status')
  @RequirePermission('/api.v1.LanguageAPI/UpdateLanguageStatus')
  async updateStatus(@Body() body: any) {
    await this.service.updateStatus(toNumberArray(body?.id), Boolean(body?.enable));
    return {};
  }

  @Delete()
  @RequirePermission('/api.v1.LanguageAPI/DeleteLanguage')
  async remove(@Query('id') id: unknown) {
    await this.service.remove(toNumberArray(id));
    return {};
  }

  @Get('list')
  @Public()
  list(@Query() query: any) {
    return this.service.list(query);
  }
}