import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Article,
  ArticleCategory,
  ArticleRelate,
  Category,
  Group,
  User,
} from '../../entities';
import { ArticleController } from './article.controller';
import { ArticleService } from './article.service';
import { SpiderModule } from '../spider/spider.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Article,
      ArticleCategory,
      ArticleRelate,
      Category,
      User,
      Group,
    ]),
    SpiderModule,
  ],
  controllers: [ArticleController],
  providers: [ArticleService],
  exports: [ArticleService],
})
export class ArticleModule {}