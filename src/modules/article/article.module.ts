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
  ],
  controllers: [ArticleController],
  providers: [ArticleService],
  exports: [ArticleService],
})
export class ArticleModule {}