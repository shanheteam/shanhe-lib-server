import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  SpiderUrl,
  SpiderArticleList,
  SpiderArticleDetail,
  SpiderDocument,
  Document,
  Attachment,
  DocumentCategory,
  Article,
  ArticleCategory,
  Category,
  User,
} from '../../entities';
import { SpiderCrawlerService } from './spider-crawler.service';
import { SpiderUrlService } from './spider-url.service';
import { SpiderArticleService } from './spider-article.service';
import { SpiderDocumentService } from './spider-document.service';
import { SpiderUrlController } from './spider-url.controller';
import { SpiderArticleController } from './spider-article.controller';
import { SpiderDocumentController } from './spider-document.controller';
import { SpiderWorkerService } from './spider-worker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SpiderUrl,
      SpiderArticleList,
      SpiderArticleDetail,
      SpiderDocument,
      Document,
      Attachment,
      DocumentCategory,
      Article,
      ArticleCategory,
      Category,
      User,
    ]),
  ],
  controllers: [SpiderUrlController, SpiderArticleController, SpiderDocumentController],
  providers: [
    SpiderCrawlerService,
    SpiderUrlService,
    SpiderArticleService,
    SpiderDocumentService,
    SpiderWorkerService,
  ],
  exports: [SpiderCrawlerService],
})
export class SpiderModule {}
