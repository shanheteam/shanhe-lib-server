import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Article, Document, Favorite, Punishment, User } from '../../entities';
import { FavoriteController } from './favorite.controller';
import { FavoriteService } from './favorite.service';
import { CreditModule } from '../credit/credit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Favorite, Document, Article, User, Punishment]),
    CreditModule,
  ],
  controllers: [FavoriteController],
  providers: [FavoriteService],
  exports: [FavoriteService],
})
export class FavoriteModule {}