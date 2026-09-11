import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { PermissionService, PermissionInput } from './permission.service';

@Controller('permission')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Put()
  @RequirePermission('/api.v1.PermissionAPI/UpdatePermission')
  update(@Body() body: PermissionInput) {
    return this.permissionService.updatePermission(body);
  }

  @Get()
  @RequirePermission('/api.v1.PermissionAPI/GetPermission')
  get(@Query('id') id?: string) {
    return this.permissionService.getPermission(id ? Number(id) : 0);
  }

  @Get('list')
  @RequirePermission('/api.v1.PermissionAPI/ListPermission')
  list(
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('wd') wd?: string,
    @Query('method') method?: string | string[],
    @Query('path') path?: string,
  ) {
    const methods = Array.isArray(method) ? method : method ? [method] : [];
    return this.permissionService.listPermission({
      page: page ? Number(page) : 0,
      size: size ? Number(size) : 0,
      wd,
      method: methods,
      path,
    });
  }
}