import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CategoryService, CategoryInput } from './category.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtUser } from '../../auth/jwt-user.type';

@Controller('category')
export class CategoryController {
  constructor(private readonly service: CategoryService) {}

  @RequirePermission('/api.v1.CategoryAPI/CreateCategory')
  @Post()
  create(@Body() body: CategoryInput) {
    return this.service.create(body);
  }

  @RequirePermission('/api.v1.CategoryAPI/UpdateCategory')
  @Put()
  update(@Body() body: CategoryInput) {
    return this.service.update(body);
  }

  @RequirePermission('/api.v1.CategoryAPI/DeleteCategory')
  @Delete()
  remove(@Query('id') id: unknown) {
    return this.service.remove(id);
  }

  @Public()
  @Get()
  get(@Query('id') id: unknown) {
    return this.service.get(id);
  }

  @Public()
  @Get('list')
  list(@Query() query: Record<string, any>, @CurrentUser() user?: JwtUser) {
    return this.service.list(query, user);
  }
}