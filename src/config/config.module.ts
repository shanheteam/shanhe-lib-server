import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Config } from '../entities';
import { ConfigService } from './config.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Config])],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}