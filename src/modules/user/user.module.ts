import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User,
  UserGroup,
  Group,
  GroupPermission,
  Permission,
  Download,
  Dynamic,
  Sign,
  EmailCode,
  Logout,
} from '../../entities';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserGroup,
      Group,
      GroupPermission,
      Permission,
      Download,
      Dynamic,
      Sign,
      EmailCode,
      Logout,
    ]),
  ],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}