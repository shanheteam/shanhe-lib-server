import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { FriendlinkService } from './friendlink.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { toNumberArray } from '../../common/query.util';

@Controller('friendlink')
export class FriendlinkController {
  constructor(private readonly service: FriendlinkService) {}

  @Post()
  @RequirePermission('/api.v1.FriendlinkAPI/CreateFriendlink')
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Put()
  @RequirePermission('/api.v1.FriendlinkAPI/UpdateFriendlink')
  update(@Body() body: any) {
    return this.service.update(body);
  }

  @Delete()
  @RequirePermission('/api.v1.FriendlinkAPI/DeleteFriendlink')
  remove(@Body() body: any) {
    return this.service.remove(toNumberArray(body?.id));
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