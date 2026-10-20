import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditLog } from '../../entities';
import { CreditService } from './credit.service';

@Module({
  imports: [TypeOrmModule.forFeature([CreditLog])],
  providers: [CreditService],
  exports: [CreditService],
})
export class CreditModule {}
