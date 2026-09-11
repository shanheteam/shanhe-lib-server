import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dynamic } from '../../entities';
import { DynamicController } from './dynamic.controller';
import { DynamicService } from './dynamic.service';

@Module({
  imports: [TypeOrmModule.forFeature([Dynamic])],
  controllers: [DynamicController],
  providers: [DynamicService],
})
export class DynamicModule {}