import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { NavigationService } from './navigation.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { toNumberArray } from '../../common/query.util';

@Controller('navigation')
export class NavigationController {
  constructor(private readonly service: NavigationService) {}

  @Post()
  @RequirePermission('/api.v1.NavigationAPI/CreateNavigation')
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Put()
  @RequirePermission('/api.v1.NavigationAPI/UpdateNavigation')
  update(@Body() body: any) {
    return this.service.update(body);
  }

  @Delete()
  @RequirePermission('/api.v1.NavigationAPI/DeleteNavigation')
  remove(@Query('id') id: unknown) {
    return this.service.remove(toNumberArray(id));
  }

  @Get()
  @Public()
  get(@Query('id') id: string) {
    return this.service.get(Number(id));
  }

  @Get('list')
  @Public()
  list(@Query() query: any) {
    return this.service.list(query);
  }
}