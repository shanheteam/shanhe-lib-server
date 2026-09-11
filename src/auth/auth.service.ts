import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { v1 as uuidV1 } from 'uuid';
import { env } from '../config/env';
import { JwtUser } from './jwt-user.type';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  /** 签发用户登录 token（与原版 CreateJWTToken 对齐） */
  createToken(userId: number): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      userId,
      uuid: uuidV1(),
      iss: 'moredoc',
      iat: now,
    };
    return this.jwtService.sign(payload, {
      secret: env.jwt.secret,
      expiresIn: `${env.jwt.expireDays}d`,
    });
  }

  /** 校验 token，返回用户标识；无效则返回 undefined */
  verifyToken(token: string): JwtUser | undefined {
    try {
      const payload = this.jwtService.verify<JwtUser & { iat: number; iss: string }>(token, {
        secret: env.jwt.secret,
      });
      return {
        userId: Number(payload.userId),
        uuid: payload.uuid,
        exp: payload.exp,
      };
    } catch {
      return undefined;
    }
  }
}