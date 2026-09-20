import { createPublicKey } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';

/**
 * 拉取并缓存 user-center（SSO 身份提供方）的 JWKS 公钥（PEM），供 RS256 校验其 access_token。
 * 读取 oauthCustom.jwks_uri（与 token_url/userinfo_url 同 category 配置），为空时从 token_url
 * 推导出 /oauth/jwks 地址。按 kid 缓存 PEM；刷新失败时保留旧公钥静默兜底（兼容公钥轮换）。
 */
@Injectable()
export class JwksService {
  private readonly logger = new Logger(JwksService.name);
  private keyCache = new Map<string, string>(); // kid -> PEM public key
  private lastFetch = 0;
  private readonly TTL = 60 * 60 * 1000; // 1h 缓存

  constructor(private readonly config: ConfigService) {}

  /** 返回校验 user-center access_token 所需的 PEM 公钥（优先匹配 kid，其次任意可用公钥）。 */
  async getPublicKey(kid?: string): Promise<string | undefined> {
    const jwksUri = this.resolveJwksUri();
    if (!jwksUri) return undefined;

    const now = Date.now();
    if (this.keyCache.size === 0 || now - this.lastFetch > this.TTL) {
      await this.refresh(jwksUri);
    }
    if (kid && this.keyCache.get(kid)) return this.keyCache.get(kid);
    return this.keyCache.get('default') || this.keyCache.values().next().value;
  }

  private resolveJwksUri(): string {
    const configured = this.config.get('oauthCustom', 'jwks_uri', '').trim();
    if (configured) return configured;
    const tokenUrl = this.config.get('oauthCustom', 'token_url', '');
    // 形如 https://apiuser.shanhe.co/api/oauth/token → base + /oauth/jwks
    const m = tokenUrl.match(/^(https?:\/\/[^/]+)(\/api)?(\/oauth)\/token$/);
    return m ? m[1] + m[3] + '/jwks' : '';
  }

  private async refresh(jwksUri: string): Promise<void> {
    try {
      const res = await fetch(jwksUri, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error('JWKS HTTP ' + res.status);
      const body: any = await res.json();
      const keys: any[] = Array.isArray(body?.keys) ? body.keys : [];

      const next = new Map<string, string>();
      for (const jwk of keys) {
        if (!jwk?.n || !jwk?.e) continue;
        try {
          const pem = createPublicKey({ key: jwk, format: 'jwk' })
            .export({ type: 'spki', format: 'pem' })
            .toString();
          next.set(jwk.kid || 'default', pem);
        } catch (e) {
          this.logger.warn('[jwks] jwk 转换失败: ' + (e as Error).message);
        }
      }
      // 保留旧公钥，兼容 kid 匹配不到旧 token（密钥轮换）
      for (const [k, v] of this.keyCache) if (!next.has(k)) next.set(k, v);
      if (next.size) {
        this.keyCache = next;
        this.lastFetch = Date.now();
      }
    } catch (e: any) {
      this.logger.warn('[jwks] 刷新失败，沿用旧公钥: ' + e?.message);
      // lastFetch 不更新，下次调用自动重试
    }
  }
}
