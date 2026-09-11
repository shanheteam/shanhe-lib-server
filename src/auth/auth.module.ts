import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission, UserGroup, GroupPermission } from '../entities';
import { AuthService } from './auth.service';
import { PermissionService } from './permission.service';
import { AuthGuard } from './auth.guard';
import { APP_GUARD } from '@nestjs/core';

@Global()
@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([Permission, UserGroup, GroupPermission]),
  ],
  providers: [
    AuthService,
    PermissionService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, PermissionService],
})
export class AuthModule {}