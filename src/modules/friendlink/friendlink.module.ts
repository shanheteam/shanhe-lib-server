import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Friendlink } from '../../entities';
import { FriendlinkController } from './friendlink.controller';
import { FriendlinkService } from './friendlink.service';

@Module({
  imports: [TypeOrmModule.forFeature([Friendlink])],
  controllers: [FriendlinkController],
  providers: [FriendlinkService],
})
export class FriendlinkModule {}