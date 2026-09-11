import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Article,
  Comment,
  Document,
  Group,
  Punishment,
  User,
  UserGroup,
} from '../../entities';
import { CommentController } from './comment.controller';
import { CommentService } from './comment.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Comment,
      Document,
      Article,
      User,
      Group,
      UserGroup,
      Punishment,
    ]),
  ],
  controllers: [CommentController],
  providers: [CommentService],
  exports: [CommentService],
})
export class CommentModule {}