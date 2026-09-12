import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Config } from '../../entities';
import { WechatpayController } from './wechatpay.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Config])],
  controllers: [WechatpayController],
})
export class PayConfigModule {}
