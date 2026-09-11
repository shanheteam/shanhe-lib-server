import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group, GroupPermission } from '../../entities';
import { GroupController } from './group.controller';
import { GroupService } from './group.service';

@Module({
  imports: [TypeOrmModule.forFeature([Group, GroupPermission])],
  controllers: [GroupController],
  providers: [GroupService],
})
export class GroupModule {}