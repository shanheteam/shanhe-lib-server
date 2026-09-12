import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sms } from '../../entities';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';

@Module({
  imports: [TypeOrmModule.forFeature([Sms])],
  controllers: [SmsController],
  providers: [SmsService],
})
export class SmsModule {}
