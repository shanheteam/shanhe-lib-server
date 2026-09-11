import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import {
  Attachment,
  User,
  Group,
  UserGroup,
  Permission,
  GroupPermission,
  Punishment,
} from '../../entities';
import { AttachmentService } from './attachment.service';
import { AttachmentController } from './attachment.controller';
import { UploadController } from './upload.controller';
import { FileController } from './file.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Attachment,
      User,
      Group,
      UserGroup,
      Permission,
      GroupPermission,
      Punishment,
    ]),
    JwtModule.register({}),
  ],
  controllers: [AttachmentController, UploadController, FileController],
  providers: [AttachmentService],
  exports: [AttachmentService],
})
export class AttachmentModule {}