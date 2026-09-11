import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CommentService } from './comment.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtUser } from '../../auth/jwt-user.type';
import { PermissionService } from '../../auth/permission.service';

/**
 * 评论 API 控制器。
 * 路由前缀：/api/v1/comment，对应 proto 中的 CommentAPI。
 */
@Controller('comment')
export class CommentController {
  constructor(
    private readonly service: CommentService,
    private readonly permissionService: PermissionService,
  ) {}

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
    return this.service.createComment(user?.userId ?? 0, body, ip || '');
  }

  @RequirePermission('/api.v1.CommentAPI/UpdateComment')
  @Put()
  async update(@Body() body: Record<string, any>) {
    await this.service.updateComment(body);
    return {};
  }

  @RequireLogin()
  @Delete()
  async remove(@Query('id') id: unknown, @CurrentUser() user: JwtUser) {
    const userId = user?.userId ?? 0;
    const isAdmin = await this.permissionService.isAdmin(userId);
    await this.service.deleteComment(this.numArray(id), userId, isAdmin);
    return {};
  }

  @RequirePermission('/api.v1.CommentAPI/CheckComment')
  @Post('check')
  async check(@Body() body: Record<string, any>) {
    await this.service.checkComment(this.numArray(body.id), Number(body.status) || 0);
    return {};
  }

  @RequirePermission('/api.v1.CommentAPI/GetComment')
  @Get()
  get(@Query('id') id: unknown) {
    return this.service.getComment(this.numArray(id)[0] || 0);
  }

  @Public()
  @Get('list')
  async list(
    @Query() query: Record<string, any>,
    @CurrentUser() user?: JwtUser,
  ) {
    const userId = user?.userId ?? 0;
    const isAdmin = userId > 0 ? await this.permissionService.isAdmin(userId) : false;
    return this.service.listComment(query, userId, isAdmin);
  }
}