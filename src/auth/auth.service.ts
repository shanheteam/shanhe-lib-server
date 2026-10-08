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

  /** 校验登录 token，返回用户标识；无效则返回 undefined */
  verifyToken(token: string): JwtUser | undefined {
    try {
      const payload = this.jwtService.verify<JwtUser & { iat: number; iss: string }>(token, {
        secret: env.jwt.secret,
      });
      // 只接受本系统签发的**登录** token，防止其它用途的 token 被当作登录凭证：
      //  · iss 必须为 'moredoc'（下载 token 的载荷只有 ip，没有 iss）
      //  · userId 必须是正整数。下载 token 解出的 userId 是 NaN，而 NaN 为真值，
      //    能绕过 `if (!request.user)` 与 `userId <= 0` 之类的防御。
      if (payload.iss !== 'moredoc') return undefined;
      const userId = Number(payload.userId);
      if (!Number.isInteger(userId) || userId <= 0) return undefined;
      return {
        userId,
        uuid: payload.uuid,
        exp: payload.exp,
      };
    } catch {
      return undefined;
    }
  }
}