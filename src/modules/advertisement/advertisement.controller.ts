import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AdvertisementService } from './advertisement.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtUser } from '../../auth/jwt-user.type';
import { asArray, toNumberArray } from '../../common/query.util';

@Controller('advertisement')
export class AdvertisementController {
  constructor(private readonly service: AdvertisementService) {}

  @Post()
  @RequirePermission('/api.v1.AdvertisementAPI/CreateAdvertisement')
  create(@Body() body: any, @CurrentUser() user: JwtUser) {
    return this.service.create(body, user?.userId ?? 0);
  }

  @Put()
  @RequirePermission('/api.v1.AdvertisementAPI/UpdateAdvertisement')
  update(@Body() body: any) {
    return this.service.update(body);
  }

  @Delete()
  @RequirePermission('/api.v1.AdvertisementAPI/DeleteAdvertisement')
  remove(@Body() body: any) {
    return this.service.remove(toNumberArray(body?.id));
  }

  @Get('position')
  @Public()
  getByPosition(@Query('position') position: any) {
    return this.service.getByPosition(asArray(position));
  }

  @Get()
  @RequirePermission('/api.v1.AdvertisementAPI/GetAdvertisement')
  get(@Query('id') id: string) {
    return this.service.get(Number(id));
  }

  @Get('list')
  @RequirePermission('/api.v1.AdvertisementAPI/ListAdvertisement')
  list(@Query() query: any) {
    return this.service.list(query);
  }
}