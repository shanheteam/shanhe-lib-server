import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Download } from '../../entities';
import { DownloadController } from './download.controller';
import { DownloadService } from './download.service';

@Module({
  imports: [TypeOrmModule.forFeature([Download])],
  controllers: [DownloadController],
  providers: [DownloadService],
})
export class DownloadModule {}