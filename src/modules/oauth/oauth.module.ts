import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { User, UserGroup, Group, UserOauth } from '../../entities';
import { OauthController } from './oauth.controller';
import { OauthService } from './oauth.service';
import { JwksService } from './jwks.service';
import { OidcDiscoveryService } from './oidc-discovery.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserGroup, Group, UserOauth]),
    JwtModule.register({}),
  ],
  controllers: [OauthController],
  providers: [OauthService, JwksService, OidcDiscoveryService],
})
export class OauthModule {}
