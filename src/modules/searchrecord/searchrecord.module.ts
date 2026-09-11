import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchRecord } from '../../entities';
import { SearchRecordController } from './searchrecord.controller';
import { SearchRecordService } from './searchrecord.service';

@Module({
  imports: [TypeOrmModule.forFeature([SearchRecord])],
  controllers: [SearchRecordController],
  providers: [SearchRecordService],
})
export class SearchRecordModule {}