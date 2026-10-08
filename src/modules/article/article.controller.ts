import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ArticleService } from './article.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtUser } from '../../auth/jwt-user.type';

@Controller('article')
export class ArticleController {
  constructor(private readonly service: ArticleService) {}

  @RequireLogin()
  @Post()
  create(@Body() body: Record<string, any>, @CurrentUser() user: JwtUser) {
    return this.service.create(body, user);
  }

  @RequireLogin()
  @Put()
  update(@Body() body: Record<string, any>, @CurrentUser() user: JwtUser) {
    return this.service.update(body, user);
  }

  @RequireLogin()
  @Delete()
  remove(@Query('id') id: unknown, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user);
  }

  @Public()
  @Get()
  get(@Query() query: Record<string, any>, @CurrentUser() user?: JwtUser) {
    return this.service.get(query, user);
  }

  @Public()
  @Get('list')
  list(@Query() query: Record<string, any>, @CurrentUser() user?: JwtUser) {
    return this.service.list(query, user);
  }

  @RequirePermission('/api.v1.ArticleAPI/SetArticlesCategory')
  @Put('category')
  setCategory(@Body() body: Record<string, any>) {
    return this.service.setArticlesCategory(body.article_id, body.category_id);
  }

  @RequirePermission('/api.v1.ArticleAPI/RecommendArticles')
  @Put('recommend')
  recommend(@Body() body: Record<string, any>) {
    return this.service.recommendArticles(body.article_id, body.is_recommend);
  }

  @RequirePermission('/api.v1.ArticleAPI/CheckArticles')
  @Put('check')
  check(@Body() body: Record<string, any>) {
    return this.service.checkArticles(
      body.article_id,
      body.status,
      body.rejeact_reason,
    );
  }

  @RequirePermission('/api.v1.ArticleAPI/CheckArticles')
  @Put('notice')
  notice(@Body() body: Record<string, any>) {
    return this.service.noticeArticles(body.article_id, body.is_notice);
  }

  @RequirePermission('/api.v1.ArticleAPI/ListRecycleArticle')
  @Get('recycle/list')
  recycleList(@Query() query: Record<string, any>) {
    return this.service.listRecycle(query);
  }

  @RequirePermission('/api.v1.ArticleAPI/RestoreRecycleArticle')
  @Post('recycle/restore')
  restore(@Body() body: Record<string, any>) {
    return this.service.restore(body.id);
  }

  @RequirePermission('/api.v1.ArticleAPI/DeleteRecycleArticle')
  @Delete('recycle')
  deleteRecycle(@Query('id') id: unknown) {
    return this.service.deleteRecycle(id);
  }

  @RequirePermission('/api.v1.ArticleAPI/EmptyRecycleArticle')
  @Delete('recycle/empty')
  emptyRecycle() {
    return this.service.emptyRecycle();
  }

  @Public()
  @Get('search')
  search(@Query() query: Record<string, any>) {
    return this.service.search(query);
  }

  @Public()
  @Get('related')
  related(@Query() query: Record<string, any>) {
    return this.service.getRelated(query);
  }
}