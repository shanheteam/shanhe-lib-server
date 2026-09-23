import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';

/** OIDC Provider 通过 `/.well-known/openid-configuration` 暴露的配置片段（RP 侧只需其中端点）。 */
export interface OidcDiscoveryDoc {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  token_endpoint_auth_methods_supported?: string[];
}

const OAUTH_CUSTOM = 'oauthCustom';

/**
 * 可选：OIDC Discovery 自动发现。
 * 规则：优先取手动配置 discovery_url，否则按 issuer / token_url / authorize_url 推导
 * `/.well-known/openid-configuration`。拉取结果按 category 缓存（TTL），失败时回退 null 交由手动配置兜底。
 */
@Injectable()
export class OidcDiscoveryService {
  private readonly logger = new Logger(OidcDiscoveryService.name);
  private readonly TTL = 30 * 60 * 1000; // 30 分钟
  private cache = new Map<string, { data: OidcDiscoveryDoc | null; at: number }>();

  constructor(private readonly config: ConfigService) {}

  async discover(category: string = OAUTH_CUSTOM): Promise<OidcDiscoveryDoc | null> {
    const url = this.resolveDiscoveryUrl(category);
    if (!url) return null;

    const hit = this.cache.get(category);
    if (hit && Date.now() - hit.at < this.TTL) return hit.data;

    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      const data: OidcDiscoveryDoc = {
        issuer: body.issuer as string | undefined,
        authorization_endpoint: body.authorization_endpoint as string | undefined,
        token_endpoint: body.token_endpoint as string | undefined,
        userinfo_endpoint: body.userinfo_endpoint as string | undefined,
        jwks_uri: body.jwks_uri as string | undefined,
        token_endpoint_auth_methods_supported: body.token_endpoint_auth_methods_supported as
          | string[]
          | undefined,
      };
      this.cache.set(category, { data, at: Date.now() });
      this.logger.log(`[oidc.discovery] success ${url}`);
      return data;
    } catch (e: any) {
      this.cache.set(category, { data: null, at: Date.now() });
      this.logger.warn(`[oidc.discovery] failed ${url}: ${e?.message}，回退手动配置`);
      return null;
    }
  }

  private resolveDiscoveryUrl(category: string): string {
    const explicit = this.config.get(category, 'discovery_url', '').trim();
    if (explicit) return explicit;

    const issuer = this.config.get(category, 'issuer', '').trim();
    if (issuer) return issuer.replace(/\/+$/, '') + '/.well-known/openid-configuration';

    for (const key of ['token_url', 'authorize_url']) {
      const v = this.config.get(category, key, '').trim();
      const base = this.deriveOidcBase(v);
      if (base) return base + '/.well-known/openid-configuration';
    }
    return '';
  }

  /** 从 /api/oauth/token 或 /oauth/authorize 推导 issuer 基址（与 Provider OIDC_ISSUER 推导对齐）。 */
  private deriveOidcBase(url: string): string {
    try {
      const u = new URL(url);
      if (/\/api\//i.test(u.pathname)) return (u.origin + '/api').replace(/\/+$/, '');
      return u.origin.replace(/\/+$/, '');
    } catch {
      return '';
    }
  }
}