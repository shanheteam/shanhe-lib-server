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
import { positiveNumberArray } from '../../common/query.util';

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
    // 能否删除「他人」评论，取决于是否拥有 DeleteComment 权限（root 恒有）。
    // 此前用 permissionService.isAdmin()（=拥有任意一条 group_permission），
    // 导致被授过任意一项权限（如普通用户的「上传头像」）的用户即可删除全站评论。
    // 无该权限时仍可删除自己的评论（由 service 内的 user_id 归属过滤保证）。
    const canDeleteAny = await this.permissionService.check(
      userId,
      '/api.v1.CommentAPI/DeleteComment',
    );
    await this.service.deleteComment(positiveNumberArray(id), userId, canDeleteAny);
    return {};
  }

  @RequirePermission('/api.v1.CommentAPI/CheckComment')
  @Post('check')
  async check(@Body() body: Record<string, any>) {
    await this.service.checkComment(positiveNumberArray(body.id), Number(body.status) || 0);
    return {};
  }

  @RequirePermission('/api.v1.CommentAPI/GetComment')
  @Get()
  get(@Query('id') id: unknown) {
    return this.service.getComment(positiveNumberArray(id)[0] || 0);
  }

  @Public()
  @Get('list')
  async list(
    @Query() query: Record<string, any>,
    @CurrentUser() user?: JwtUser,
  ) {
    const userId = user?.userId ?? 0;
    // 查看未审核评论、按正文搜索需 ListComment 权限；此前用 isAdmin() 判定过宽
    const canListAll =
      userId > 0
        ? await this.permissionService.check(userId, '/api.v1.CommentAPI/ListComment')
        : false;
    return this.service.listComment(query, userId, canListAll);
  }
}