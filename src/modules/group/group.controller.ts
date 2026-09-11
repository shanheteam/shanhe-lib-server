import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { GroupService, GroupInput } from './group.service';

@Controller('group')
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  @Post()
  @RequirePermission('/api.v1.GroupAPI/CreateGroup')
  create(@Body() body: GroupInput) {
    return this.groupService.createGroup(body);
  }

  @Put()
  @RequirePermission('/api.v1.GroupAPI/UpdateGroup')
  update(@Body() body: GroupInput) {
    return this.groupService.updateGroup(body);
  }

  @Delete()
  @RequirePermission('/api.v1.GroupAPI/DeleteGroup')
  delete(@Query('id') id?: string | string[]) {
    const ids = (Array.isArray(id) ? id : id ? [id] : [])
      .map(Number)
      .filter((n) => n > 0);
    return this.groupService.deleteGroup(ids);
  }

  @Get()
  get(@Query('id') id?: string, @Query('title') title?: string) {
    return this.groupService.getGroup(
      id ? Number(id) : undefined,
      title || undefined,
    );
  }

  @Get('list')
  list(
    @Query('wd') wd?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('field') field?: string | string[],
  ) {
    const fields = Array.isArray(field) ? field : field ? [field] : [];
    return this.groupService.listGroup({
      wd,
      page: page ? Number(page) : 0,
      size: size ? Number(size) : 0,
      field: fields,
    });
  }

  @Get('permission')
  @RequirePermission('/api.v1.GroupAPI/GetGroupPermission')
  getPermission(@Query('id') id?: string) {
    return this.groupService.getGroupPermission(id ? Number(id) : 0);
  }

  @Put('permission')
  @RequirePermission('/api.v1.GroupAPI/UpdateGroupPermission')
  updatePermission(
    @Body() body: { group_id?: number; permission_id?: number[] },
  ) {
    return this.groupService.updateGroupPermission(
      body.group_id ?? 0,
      body.permission_id ?? [],
    );
  }
}