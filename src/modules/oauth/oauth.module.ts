import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, UserGroup, Group, UserOauth } from '../../entities';
import { OauthController } from './oauth.controller';
import { OauthService } from './oauth.service';
import { JwksService } from './jwks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserGroup, Group, UserOauth]),
  ],
  controllers: [OauthController],
  providers: [OauthService, JwksService],
})
export class OauthModule {}
