import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import {
  Document,
  DocumentCategory,
  DocumentRelate,
  DocumentScore,
  DocumentError,
  Category,
  Attachment,
  AttachmentContent,
  User,
  Download,
  DownloadCode,
  Group,
  UserGroup,
} from '../../entities';
import { ConverterModule } from '../converter/converter.module';
import { DocumentService } from './document.service';
import { DocumentController } from './document.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Document,
      DocumentCategory,
      DocumentRelate,
      DocumentScore,
      DocumentError,
      Category,
      Attachment,
      AttachmentContent,
      User,
      Download,
      DownloadCode,
      Group,
      UserGroup,
    ]),
    JwtModule.register({}),
    ConverterModule,
  ],
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService],
})
export class DocumentModule {}