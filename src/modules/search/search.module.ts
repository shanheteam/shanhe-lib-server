import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { DocumentModule } from '../document/document.module';
import { ArticleModule } from '../article/article.module';

@Module({
  imports: [DocumentModule, ArticleModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}