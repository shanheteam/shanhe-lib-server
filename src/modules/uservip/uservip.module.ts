import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserVip, User } from '../../entities';
import { UserVipController } from './uservip.controller';
import { UserVipService } from './uservip.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserVip, User])],
  controllers: [UserVipController],
  providers: [UserVipService],
})
export class UserVipModule {}
