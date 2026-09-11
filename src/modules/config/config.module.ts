import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Config,
  Language,
  User,
  Document,
  Category,
  Article,
  Comment,
  Banner,
  Friendlink,
  Report,
} from '../../entities';
import { ConfigController } from './config.controller';

/**
 * 配置 API 模块：提供站点设置、配置项管理、系统统计、环境依赖、
 * 设备信息、站点地图及 SQL 模式等接口，与原版 ConfigAPI 对齐。
 * 注意：与全局的 src/config/config.module.ts（ConfigService）互不影响。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Config,
      Language,
      User,
      Document,
      Category,
      Article,
      Comment,
      Banner,
      Friendlink,
      Report,
    ]),
  ],
  controllers: [ConfigController],
})
export class ConfigApiModule {}