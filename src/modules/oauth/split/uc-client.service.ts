import { Logger } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service';
import { JwksService } from '../jwks.service';
import { OidcDiscoveryService } from '../oidc-discovery.service';
import { verifyIdToken } from '../id-token.verify';
import { Biz } from '../../../common/biz.exception';

// OAuth type constants (aligned with frontend enum)
const OAUTH_TYPE_CUSTOM = 6;

const OAUTH_TYPE_TO_CATEGORY: Record<number, string> = {
  [OAUTH_TYPE_CUSTOM]: 'oauthCustom',
};

/**
 * 与 user-center（OIDC Provider）通信的 HTTP/端点层：换 token、拉用户信息、身份解析、
 * 令牌续期、uc 基址推导。从 oauth.service.ts 拆分，纯外部访问，无本地用户匹配逻辑。
 */
export class UcClientService {
  private readonly logger = new Logger(UcClientService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly jwks: JwksService,
    private readonly discovery: OidcDiscoveryService,
  ) {}

  /**
   * 推导 user 统一认证中心（uc）API 基址。
   * oauthCustom.token_url 形如 https://apiuser.shanhe.co/api/oauth/token，
   * uc 基址 = token_url 去掉路径部分 + /api，即 https://apiuser.shanhe.co/api。
   */
  ucBase(): string {
    const category = OAUTH_TYPE_TO_CATEGORY[OAUTH_TYPE_CUSTOM];
    const tokenUrl = String(this.config.get(category, 'token_url') || '').trim();
    if (!tokenUrl) {
      throw Biz.internal('自定义OAuth未配置token_url');
    }
    return this.ucBaseOf(tokenUrl);
  }

  /** 从任意 uc 端点推导 uc API 基址（形如 /api/oauth/token → https://apiuser.shanhe.co/api）。
   * 必须用 URL 解析取 origin，禁止用 lastIndexOf('/api') 切字符串——host 含 "apiuser" 时
   * 会误匹配出 `http://api` 之类的错误基址。 */
  ucBaseOf(tokenUrl: string): string {
    try {
      const u = new URL(tokenUrl);
      return `${u.origin.replace(/\/+$/, '')}/api`;
    } catch {
      throw Biz.internal('自定义OAuth token_url 格式异常');
    }
  }

  /**
   * 解析 OIDC issuer：优先取 discovery 的 issuer（与 Provider 一致），
   * 为空则从 token_url 的 origin (+ /api/oauth 挂载前缀) 推导。
   */
  async resolveIssuer(category: string): Promise<string> {
    const disc = await this.discovery.discover(category);
    const discovered = disc && disc.issuer;
    if (discovered) return discovered;
    const configured = this.config.get(category, 'issuer', '').trim();
    if (configured) return configured;
    const tokenUrl = this.config.get(category, 'token_url', '');
    try {
      const u = new URL(tokenUrl);
      const prefix = /\/api\/oauth\/token/i.test(tokenUrl) ? '/api/oauth' : '';
      return u.origin + prefix;
    } catch {
      return configured;
    }
  }

  /**
   * 身份解析：优先校验 id_token（JWKS 验 RS256 签名 + iss/aud/exp/nonce）取 sub，
   * 否则回退到 access_token 解析的 openid/sub（旧 Provider 不签 id_token 时兼容）。
   * id_token 存在但校验失败则硬失败，拒绝脆弱登录。
   */
  async resolveOpenid(
    tokenData: Record<string, string>,
    client_id: string,
    issuer: string,
    nonce?: string,
  ): Promise<string> {
    if (tokenData.id_token) {
      try {
        const claims = await verifyIdToken(
          tokenData.id_token,
          client_id,
          issuer,
          (kid) => this.jwks.getPublicKey(kid),
          nonce,
        );
        this.logger.debug(`[OIDC] id_token verified, sub=${String(claims.sub)}`);
        return String(claims.sub || '');
      } catch (e: any) {
        throw Biz.internal(`[OIDC] ` + (e?.message || 'id_token 校验失败'));
      }
    }
    return tokenData.openid || tokenData.sub || tokenData.id || '';
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(
    oauthType: number,
    code: string,
    client_id: string,
    client_secret: string,
    redirect_url: string,
    codeVerifier?: string,
  ): Promise<Record<string, string>> {
    const category = OAUTH_TYPE_TO_CATEGORY[oauthType];

    if (category === 'oauthCustom') {
      const disc = await this.discovery.discover(category);
      const token_url =
        (disc && disc.token_endpoint) || this.config.get(category, 'token_url');
      if (!token_url) {
        throw Biz.internal('自定义OAuth未配置token_url（且 Discovery 未发现）');
      }

      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id,
        client_secret,
        redirect_uri: redirect_url,
      });

      // Add code_verifier for PKCE
      if (codeVerifier) {
        params.set('code_verifier', codeVerifier);
      }

      const bodyStr = params.toString();
      let response: Response | undefined;
      let lastErr: any;
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await fetch(token_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: bodyStr,
          });
          break;
        } catch (err: any) {
          lastErr = err;
          console.error(`[OAuth] token fetch attempt ${attempt}/${maxRetries} failed:`, err.message);
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      if (!response) {
        throw Biz.internal(`获取token网络错误(重试${maxRetries}次): ${lastErr?.message}`);
      }

      if (!response.ok) {
        const errText = await response.text();
        throw Biz.internal(`获取token失败: ${response.status} ${errText}`);
      }

      const data = await response.json();
      this.logger.debug(
        `[OAuth] token response data keys: ${Object.keys(data)} data: ${JSON.stringify(data)}`,
      );

      // Try to extract openid from JWT payload (sub field)
      let openid = data.openid || data.sub || data.id || '';
      if (!openid && data.access_token) {
        try {
          const parts = data.access_token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
            openid = payload.sub || payload.id || '';
            this.logger.debug(`[OAuth] extracted openid from JWT payload: ${openid}`);
          }
        } catch (e) {
          console.error('[OAuth] failed to decode JWT:', e);
        }
      }

      return {
        access_token: data.access_token || '',
        refresh_token: data.refresh_token || '',
        scope: data.scope || '',
        openid,
        id_token: data.id_token || '',
      };
    }

    // 仅支持自定义 OAuth（SSO 接入 user-center）
    throw Biz.invalidArgument('不支持的OAuth类型');
  }

  /**
   * Get user info from OAuth provider
   */
  async getUserInfo(
    oauthType: number,
    access_token: string,
    openid: string,
  ): Promise<Record<string, string>> {
    const category = OAUTH_TYPE_TO_CATEGORY[oauthType];

    if (category === 'oauthCustom') {
      const disc = await this.discovery.discover(category);
      const userinfo_url =
        (disc && disc.userinfo_endpoint) || this.config.get(category, 'userinfo_url');
      if (!userinfo_url) {
        throw Biz.internal('自定义OAuth未配置userinfo_url（且 Discovery 未发现）');
      }

      let response: Response | undefined;
      let lastErr: any;
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await fetch(userinfo_url, {
            headers: { Authorization: `Bearer ${access_token}` },
          });
          break;
        } catch (err: any) {
          lastErr = err;
          console.error(`[OAuth] userinfo fetch attempt ${attempt}/${maxRetries} failed:`, err.message);
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      if (!response) {
        throw Biz.internal(`获取用户信息网络错误(重试${maxRetries}次): ${lastErr?.message}`);
      }

      if (!response.ok) {
        throw Biz.internal(`获取用户信息失败: ${response.status}`);
      }

      return await response.json();
    }

    // 仅支持自定义 OAuth（SSO 接入 user-center）
    throw Biz.invalidArgument('不支持的OAuth类型');
  }

  /**
   * 用父域 refresh_token 经 user-center /oauth/token 换新令牌，返回三态，供调用方区分：
   * - ok         ：续期成功，返回新 access_token / refresh_token；
   * - unreachable：网络失败 / 超时 / user-center 5xx（服务重启、网关错误）→ 无法确证，
   *                 调用方应进入降级窗口而非硬登出，避免 user-center 瞬时故障时全员误登出；
   * - rejected   ：user-center 可达且返回 4xx 业务拒绝（invalid_grant 等，令牌确证失效）
   *                 或响应体缺少合法 access_token → 调用方应视为会话失效硬登出。
   */
  async tryRefreshUc(
    refreshToken: string,
  ): Promise<
    { status: 'ok'; access_token: string; refresh_token: string }
    | { status: 'unreachable' }
    | { status: 'rejected' }
  > {
    const category = OAUTH_TYPE_TO_CATEGORY[OAUTH_TYPE_CUSTOM];
    const client_id = this.config.get(category, 'client_id');
    const client_secret = this.config.get(category, 'client_secret');
    const base = this.ucBase();
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id,
      client_secret,
      scope: (this.config.get(category, 'scope') || 'openid profile email').trim(),
    });
    let response: Response | undefined;
    try {
      response = await fetch(`${base}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e: any) {
      console.warn('[SSO] uc refresh network fail:', e?.message);
      return { status: 'unreachable' };
    }
    if (!response) return { status: 'unreachable' };
    // 5xx 属 user-center 服务端错误（重启/网关/部署），非业务判定，视为不可达走降级，
    // 与 4xx（确证失效）严格区分：前者不该导致全员硬登出。
    const status = response.status;
    if (status >= 500 && status <= 599) {
      console.warn(`[SSO] uc refresh server error: ${status}`);
      return { status: 'unreachable' };
    }
    const data: any = await response.json().catch(() => ({}));
    // 2xx 且拿到合法 access_token → 成功；其余（4xx 拒绝 / 体缺失）→ 确证失效
    if (status >= 200 && status < 300 && data?.access_token) {
      return {
        status: 'ok',
        access_token: String(data.access_token),
        refresh_token: String(data.refresh_token || ''),
      };
    }
    return { status: 'rejected' };
  }
}