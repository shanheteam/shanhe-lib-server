import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Punishment, User } from '../../entities';
import { PunishmentController } from './punishment.controller';
import { PunishmentService } from './punishment.service';

@Module({
  imports: [TypeOrmModule.forFeature([Punishment, User])],
  controllers: [PunishmentController],
  providers: [PunishmentService],
})
export class PunishmentModule {}