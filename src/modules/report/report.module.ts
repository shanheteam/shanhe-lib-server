import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document, Report } from '../../entities';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

@Module({
  imports: [TypeOrmModule.forFeature([Report, Document])],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}