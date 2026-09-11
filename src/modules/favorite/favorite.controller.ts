import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Post,
  Query,
} from '@nestjs/common';
import { FavoriteService } from './favorite.service';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtUser } from '../../auth/jwt-user.type';

/**
 * 收藏 API 控制器。
 * 路由前缀：/api/v1/favorite，对应 proto 中的 FavoriteAPI。
 */
@Controller('favorite')
export class FavoriteController {
  constructor(private readonly service: FavoriteService) {}

  private numArray(v: unknown): number[] {
    if (v === undefined || v === null || v === '') return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  }

  @RequireLogin()
  @Post()
  create(
    @Body() body: Record<string, any>,
    @Ip() ip: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createFavorite(user?.userId ?? 0, body, ip || '');
  }

  @RequireLogin()
  @Delete()
  async remove(@Query('id') id: unknown, @CurrentUser() user: JwtUser) {
    await this.service.deleteFavorite(user?.userId ?? 0, this.numArray(id));
    return {};
  }

  @RequireLogin()
  @Get()
  get(
    @Query('document_id') documentId: unknown,
    @Query('type') type: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.getFavorite(
      user?.userId ?? 0,
      this.numArray(documentId)[0] || 0,
      Number(type) || 0,
    );
  }

  @RequireLogin()
  @Get('list')
  list(
    @Query() query: Record<string, any>,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.listFavorite(
      user?.userId ?? 0,
      Number(query.type) || 0,
      query,
    );
  }
}