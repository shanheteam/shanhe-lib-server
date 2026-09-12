import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { SpiderArticleService } from './spider-article.service';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { toNumberArray } from '../../common/query.util';

/**
 * 文章采集：列表页来源 spider_article_list 与文章详情 spider_article_detail
 * 路由对齐专业版 /api/v1/spiderarticle/source[/status]、/api/v1/spiderarticle/detail[/batch]
 */
@Controller('spiderarticle')
export class SpiderArticleController {
  constructor(private readonly service: SpiderArticleService) {}

  // ---------- 列表页来源 ----------

  @Get('source/list')
  @RequirePermission('/api.v1.SpiderAPI/ListSpiderArticleList')
  listSource(@Query() query: any) {
    return this.service.listSource(query);
  }

  @Get('source')
  @RequirePermission('/api.v1.SpiderAPI/GetSpiderArticleList')
  getSource(@Query('id') id: string) {
    return this.service.getSource(Number(id));
  }

  @Post('source')
  @RequirePermission('/api.v1.SpiderAPI/CreateSpiderArticleList')
  createSource(@Body() body: any) {
    return this.service.createSource(body ?? {});
  }

  @Put('source')
  @RequirePermission('/api.v1.SpiderAPI/UpdateSpiderArticleList')
  updateSource(@Body('spider_article_list') data: any, @Body() body: any) {
    return this.service.updateSource(data ?? body ?? {});
  }

  @Delete('source')
  @RequirePermission('/api.v1.SpiderAPI/DeleteSpiderArticleList')
  removeSource(@Query('id') id: unknown) {
    return this.service.removeSource(toNumberArray(id));
  }

  @Put('source/status')
  @RequirePermission('/api.v1.SpiderAPI/UpdateSpiderArticleListStatus')
  setSourceStatus(@Body() body: { id?: unknown; status?: number }) {
    return this.service.setSourceStatus(toNumberArray(body.id), Number(body.status));
  }

  // ---------- 文章详情 ----------

  @Get('detail/list')
  @RequirePermission('/api.v1.SpiderAPI/ListSpiderArticleDetail')
  listDetail(@Query() query: any) {
    return this.service.listDetail(query);
  }

  @Get('detail')
  @RequirePermission('/api.v1.SpiderAPI/GetSpiderArticleDetail')
  getDetail(@Query('id') id: string) {
    return this.service.getDetail(Number(id));
  }

  @Put('detail')
  @RequirePermission('/api.v1.SpiderAPI/UpdateSpiderArticleDetail')
  updateDetail(@Body('spider_article_detail') data: any, @Body() body: any) {
    return this.service.updateDetail(data ?? body ?? {});
  }

  @Put('detail/batch')
  @RequirePermission('/api.v1.SpiderAPI/BatchUpdateSpiderArticleDetail')
  batchDetail(@Body('spider_article_detail') items: any[]) {
    return this.service.batchDetail(items);
  }

  @Delete('detail')
  @RequirePermission('/api.v1.SpiderAPI/DeleteSpiderArticleDetail')
  removeDetail(@Query('id') id: unknown) {
    return this.service.removeDetail(toNumberArray(id));
  }
}
