import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserGroup, Group, UserOauth } from '../../entities';
import { ConfigService } from '../../config/config.service';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import { JwksService } from './jwks.service';
import { Biz, BizException } from '../../common/biz.exception';
import { makePassword, randomString } from '../../common/password.util';

// OAuth type constants (aligned with frontend enum)
const OAUTH_TYPE_QQ = 1;
const OAUTH_TYPE_WECHAT = 2;
const OAUTH_TYPE_GITEE = 3;
const OAUTH_TYPE_GITHUB = 4;
const OAUTH_TYPE_WECHAT_MINI = 5;
const OAUTH_TYPE_CUSTOM = 6;
const OAUTH_TYPE_GOOGLE = 7;
const OAUTH_TYPE_OFFICIAL_ACCOUNT = 8;

const OAUTH_TYPE_TO_CATEGORY: Record<number, string> = {
  [OAUTH_TYPE_QQ]: 'oauthQQ',
  [OAUTH_TYPE_WECHAT]: 'oauthWechat',
  [OAUTH_TYPE_GITEE]: 'oauthGitee',
  [OAUTH_TYPE_GITHUB]: 'oauthGithub',
  [OAUTH_TYPE_WECHAT_MINI]: 'oauthWechatMini',
  [OAUTH_TYPE_CUSTOM]: 'oauthCustom',
  [OAUTH_TYPE_GOOGLE]: 'oauthGoogle',
  [OAUTH_TYPE_OFFICIAL_ACCOUNT]: 'oauthOfficialAccount',
};

const OAUTH_TYPE_TO_NAME: Record<number, string> = {
  [OAUTH_TYPE_QQ]: 'QQ',
  [OAUTH_TYPE_WECHAT]: '微信',
  [OAUTH_TYPE_GITEE]: '码云',
  [OAUTH_TYPE_GITHUB]: 'GitHub',
  [OAUTH_TYPE_WECHAT_MINI]: '微信小程序',
  [OAUTH_TYPE_CUSTOM]: '山河大学学籍',
  [OAUTH_TYPE_GOOGLE]: '谷歌',
  [OAUTH_TYPE_OFFICIAL_ACCOUNT]: '公众号',
};

interface OauthLoginBody {
  code?: string;
  oauth_type?: number;
  code_verifier?: string;
}

interface OauthBindBody {
  code?: string;
  oauth_type?: number;
}

interface PasswordLoginBody {
  username?: string;
  password?: string;
}

interface UcRegisterBody {
  email?: string;
  real_name?: string;
  password?: string;
  student_id?: string;
  email_code?: string;
}

interface UcStudentIdResult {
  student_id?: string;
}

@Injectable()
export class OauthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserGroup)
    private readonly userGroupRepo: Repository<UserGroup>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(UserOauth)
    private readonly userOauthRepo: Repository<UserOauth>,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly jwtService: JwtService,
    private readonly jwks: JwksService,
  ) {}

  /**
   * Get enabled OAuth configs for frontend display
   */
  async getConfigs(): Promise<{ oauths: any[] }> {
    const categories = Object.values(OAUTH_TYPE_TO_CATEGORY);
    const oauths: any[] = [];

    for (let i = 0; i < categories.length; i++) {
      const category = categories[i];
      const oauthType = Object.keys(OAUTH_TYPE_TO_CATEGORY).find(
        (k) => OAUTH_TYPE_TO_CATEGORY[Number(k)] === category,
      );
      if (!oauthType) continue;

      const enabled = this.config.getBool(category, 'enable');
      if (!enabled) continue;

      const client_id = this.config.get(category, 'client_id');
      const client_secret = this.config.get(category, 'client_secret');
      const redirect_url = this.config.get(category, 'redirect_url');

      const oauth: any = {
        type: Number(oauthType),
        name: OAUTH_TYPE_TO_NAME[Number(oauthType)] || category,
        client_id,
        client_secret,
        redirect_url,
        enable: true,
      };

      // For custom OAuth, include extra fields and return base authorize URL
      if (category === 'oauthCustom') {
        const authorizeUrl = this.config.get(category, 'authorize_url');
        const scope = this.config.get(category, 'scope');
        oauth.token_url = this.config.get(category, 'token_url');
        oauth.userinfo_url = this.config.get(category, 'userinfo_url');
        oauth.scope = scope;
        // Return base authorization URL (without query params, frontend will build with PKCE)
        oauth.authorize_url_base = authorizeUrl && authorizeUrl.startsWith('http') ? authorizeUrl : '';
      }


      // logout 与 authorize 同基址：user 端 /oauth/logout。优先由后端推导，避免前端依赖
      // authorize_url_base 以 /authorize 结尾改写导致不跳转（SLO 失效）。
      try {
        const ucApi = this.ucBase().replace(/\/$/, '');
        if (ucApi) oauth.logout_url = `${ucApi}/oauth/logout`;
      } catch { /* 无 token_url 时不提供 logout_url，前端走兜底 */ }      oauths.push(oauth);
    }

    return { oauths };
  }

  /**
   * 推导 user 统一认证中心（uc）API 基址。
   * oauthCustom.token_url 形如 https://apiuser.shanhe.co/api/oauth/token，
   * uc 基址 = token_url 去掉路径部分 + /api，即 https://apiuser.shanhe.co/api。
   */
  private ucBase(): string {
    const category = OAUTH_TYPE_TO_CATEGORY[OAUTH_TYPE_CUSTOM];
    const tokenUrl = String(this.config.get(category, 'token_url') || '').trim();
    if (!tokenUrl) {
      throw Biz.internal('自定义OAuth未配置token_url');
    }
    const idx = tokenUrl.lastIndexOf('/api');
    if (idx < 0) {
      throw Biz.internal('自定义OAuth token_url 格式异常');
    }
    return tokenUrl.slice(0, idx + '/api'.length);
  }

  /**
   * 注册：lib 后端转发到 user 统一认证中心 POST ucBase/auth/register。
   * 透传 { email, real_name, password, student_id }；成功返回 uc 的 { message, userId }；
   * 非 2xx 时把 uc 的 { code, message } 映射为 Biz 错误。
   */
  async register(body: UcRegisterBody, clientIp?: string): Promise<Record<string, unknown>> {
    const ucBase = this.ucBase();
    const payload: Record<string, string> = {};
    if (body?.email) payload.email = body.email;
    if (body?.real_name) payload.real_name = body.real_name;
    if (body?.password) payload.password = body.password;
    if (body?.student_id) payload.student_id = body.student_id;
    // email_code 可选，忽略（user 侧无邮箱验证码要求）

    let response: Response | undefined;
    try {
      const regHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      // 透传真实客户端 IP，供 user 侧按真实来源做注册限流/审计（需 user 端 TRUST_PROXY 信任 lib 服务器 IP）
      if (clientIp) regHeaders['X-Forwarded-For'] = clientIp;
      response = await fetch(`${ucBase}/auth/register`, {
        method: 'POST',
        headers: regHeaders,
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      throw Biz.internal(`注册网络错误: ${err?.message}`);
    }

    let data: any = {};
    try {
      data = await response.json();
    } catch {
      /* 忽略空响应体 */
    }

    if (!response.ok) {
      console.error(
        `[OAuth] uc register failed status=${response.status} code=${String(data?.code || '')} body=`,
        data,
      );
      throw this.mapRegisterError(String(data?.code || ''), String(data?.message || ''), response.status);
    }
    return data;
  }

  /** 把 uc 注册错误 code 映射为中文 Biz 异常（429 透出 uc 的 message）。 */
  private mapRegisterError(code: string, message: string, status: number): BizException {
    if (code === 'REGISTER_IP_RATE_LIMITED' || status === 429) {
      return Biz.resourceExhausted(message || '注册过于频繁，请24小时后再试');
    }
    const map: Record<string, string> = {
      EMAIL_OCCUPIED: '该邮箱已被注册',
      STUDENT_ID_OCCUPIED: '该学号已被占用',
      REGISTER_CONFLICT: '注册信息冲突',
      REGISTER_FAILED: '注册失败',
    };
    // 优先透传 uc 返回的具体 message（如"手机号格式不正确"），
    // map 仅在 uc 未给出具体原因时作中文兜底，避免通用 code 覆盖真实原因。
    const mapped = message || map[code] || `注册失败(${status})`;
    return Biz.invalidArgument(mapped);
  }

  /**
   * 获取一个随机学号：GET ucBase/users/meta/available-student-id?year=2027 → { student_id }。
   */
  async availableStudentId(clientIp?: string): Promise<UcStudentIdResult> {
    const ucBase = this.ucBase();
    const url = `${ucBase}/users/meta/available-student-id?year=2027`;
    let response: Response | undefined;
    const stuHeaders: Record<string, string> = {};
    if (clientIp) stuHeaders['X-Forwarded-For'] = clientIp;
    try {
      response = await fetch(url, { headers: stuHeaders });
    } catch (err: any) {
      throw Biz.internal(`获取随机学号网络错误: ${err?.message}`);
    }
    if (!response.ok) {
      throw Biz.internal(`获取随机学号失败: ${response.status}`);
    }
    try {
      return (await response.json()) as UcStudentIdResult;
    } catch {
      return {};
    }
  }

  /**
   * OAuth login: exchange code for token, get user info, create/match local user
   */
  async login(body: OauthLoginBody, clientIp?: string): Promise<{
    token?: string;
    user?: Record<string, unknown>;
    oauth?: Record<string, unknown>;
  }> {
    console.log('[OAuth] login body:', JSON.stringify(body));
    const code = body.code ?? '';
    const oauthType = Number(body.oauth_type) || 0;
    const codeVerifier = body.code_verifier ?? '';
    console.log('[OAuth] codeVerifier present:', !!codeVerifier, 'len:', codeVerifier?.length);

    if (!code) {
      throw Biz.invalidArgument('code不能为空');
    }
    if (!oauthType || !OAUTH_TYPE_TO_CATEGORY[oauthType]) {
      throw Biz.invalidArgument('未知授权类型');
    }

    const category = OAUTH_TYPE_TO_CATEGORY[oauthType];
    const enabled = this.config.getBool(category, 'enable');
    if (!enabled) {
      throw Biz.invalidArgument('该登录方式未启用');
    }

    const client_id = this.config.get(category, 'client_id');
    const client_secret = this.config.get(category, 'client_secret');
    const redirect_url = this.config.get(category, 'redirect_url');

    if (!client_id || !client_secret) {
      throw Biz.internal('OAuth配置不完整');
    }

    // Exchange code for access token (with PKCE code_verifier)
    const tokenData = await this.exchangeCodeForToken(
      oauthType,
      code,
      client_id,
      client_secret,
      redirect_url,
      codeVerifier,
    );

    const access_token = tokenData.access_token || '';
    const refresh_token = tokenData.refresh_token || '';
    const scope = tokenData.scope || '';
    const openid = tokenData.openid || tokenData.sub || tokenData.id || '';

    if (!access_token || !openid) {
      throw Biz.internal('获取用户标识失败');
    }

    // Get user info from OAuth provider
    const userInfo = await this.getUserInfo(oauthType, access_token, openid);
    console.log('[OAuth] userInfo from provider:', JSON.stringify(userInfo));

    const nickname = userInfo.nickname || userInfo.name || userInfo.login || userInfo.display_name || '';
    const avatar = userInfo.avatar || userInfo.avatar_url || userInfo.picture || '';
    const email = userInfo.email || '';
    const unionid = userInfo.unionid || '';
    console.log('[OAuth] parsed - nickname:', nickname, 'email:', email, 'openid:', openid);

    return this.matchOrCreateUser({
      oauthType,
      openid,
      access_token,
      refresh_token,
      scope,
      unionid,
      nickname,
      avatar,
      email,
      clientIp,
    });
  }

  /**
   * 直接登录（ROPC）：用 user-center 账号密码换 token，不经过授权页。
   * 请求 user-center token 端点的 password grant，再取用户信息并匹配/创建本地用户。
   * 仅当 custom（user-center）客户端为 confidential 且启用时可用。
   */
  async passwordLogin(body: PasswordLoginBody, clientIp?: string): Promise<Record<string, unknown>> {
    const oauthType = OAUTH_TYPE_CUSTOM;
    const category = OAUTH_TYPE_TO_CATEGORY[oauthType];
    const username = body?.username || '';
    const password = body?.password || '';

    if (!username || !password) {
      throw Biz.invalidArgument('请输入账号和密码');
    }
    const enabled = this.config.getBool(category, 'enable');
    if (!enabled) {
      throw Biz.invalidArgument('该登录方式未启用');
    }

    const client_id = this.config.get(category, 'client_id');
    const client_secret = this.config.get(category, 'client_secret');
    const token_url = this.config.get(category, 'token_url');
    const scope = (this.config.get(category, 'scope') || 'openid profile email').trim();

    if (!client_id || !client_secret) {
      throw Biz.internal('OAuth配置不完整');
    }
    if (!token_url) {
      throw Biz.internal('自定义OAuth未配置token_url');
    }

    // 1. 用 password grant 换 token（凭据在 confidential 客户端下经 lib 后端转发）
    const params = new URLSearchParams({
      grant_type: 'password',
      username,
      password,
      client_id,
      client_secret,
      scope,
    });

    let response: Response | undefined;
    let lastErr: any;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await fetch(token_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        break;
      } catch (err: any) {
        lastErr = err;
        console.error("[OAuth] password token attempt " + attempt + "/" + maxRetries + " failed:", err.message);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
    if (!response) {
      throw Biz.internal(`获取token网络错误(重试${maxRetries}次): ${lastErr?.message}`);
    }

    const tokenData: any = await response.json();
    if (!response.ok) {
      if (tokenData?.error === 'invalid_grant') {
        throw Biz.invalidArgument('账号或密码不正确');
      }
      if (tokenData?.error === 'access_denied') {
        throw Biz.invalidArgument(tokenData?.error_description || '该账号不可登录');
      }
      throw Biz.invalidArgument(
        tokenData?.error_description || tokenData?.message || `登录失败(${response.status})`,
      );
    }

    const access_token = tokenData.access_token || '';
    const refresh_token = tokenData.refresh_token || '';
    const openid = String(tokenData.openid || tokenData.sub || '');
    const tokenScope = tokenData.scope || scope || '';

    if (!access_token || !openid) {
      throw Biz.internal('获取用户标识失败');
    }

    // 2. 获取 user-center 用户信息（name/email 按 scope 开放）
    const userInfo = await this.getUserInfo(oauthType, access_token, openid);

    // 3. 匹配或创建 lib 本地用户，返回 { token, user }
    const loginResult = await this.matchOrCreateUser({
      oauthType,
      openid,
      access_token,
      refresh_token,
      scope: tokenScope,
      unionid: '',
      nickname: userInfo.name || userInfo.nickname || '',
      avatar: userInfo.avatar || userInfo.avatar_url || userInfo.picture || '',
      email: userInfo.email || '',
      clientIp,
    });
    // 把 user-center 的 access_token 一并带出，供 controller 写共享 .shanhe.co cookie（Cookie 真源 SSO）
    return { ...loginResult, uc_access_token: access_token, uc_refresh_token: refresh_token };
  }

  /**
   * Shared: match an existing OAuth binding, match a local user by email,
   * or create a new local user. Returns { token, user }.
   */
  private async matchOrCreateUser(
    data: {
      oauthType: number;
      openid: string;
      access_token: string;
      refresh_token: string;
      scope: string;
      unionid: string;
      nickname: string;
      avatar: string;
      email: string;
      student_id?: string;
      mobile?: string;
      clientIp?: string;
    },
    opts: { skipEmailBind?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const {
      oauthType,
      openid,
      access_token,
      refresh_token,
      scope,
      unionid,
      nickname,
      avatar,
      email,
      student_id,
      mobile,
      clientIp,
    } = data;

    // Check if this OAuth account is already bound
    const existingOauth = await this.userOauthRepo.findOne({
      where: { oauth_type: oauthType, openid },
    });

    if (existingOauth) {
      // Existing binding - login as that user
      const user = await this.userRepo.findOne({
        where: { id: existingOauth.user_id },
      });
      if (!user) {
        throw Biz.notFound('用户不存在');
      }

      // Update OAuth record
      await this.userOauthRepo.update(existingOauth.id, {
        access_token,
        refresh_token,
        scope,
        nickname,
        avatar,
        unionid,
        updated_at: new Date(),
      });

      // Update user login info
      await this.userRepo.update(user.id, {
        login_at: new Date(),
        last_login_ip: clientIp,
      });

      const token = this.auth.createToken(Number(user.id));
      const groupIds = await this.getGroupIds(Number(user.id));

      return {
        token,
        user: this.buildUserJson(user, groupIds),
      };
    }

    // New OAuth account - check if email matches existing user（sso 自动建号跳过，避免误绑到现有账号）
    if (!opts?.skipEmailBind && email) {
      const existingUser = await this.userRepo.findOne({ where: { email } });
      if (existingUser) {
        // Bind to existing user by email
        const now = new Date();
        await this.userOauthRepo.save(
          this.userOauthRepo.create({
            user_id: Number(existingUser.id),
            oauth_type: oauthType,
            openid,
            nickname,
            avatar,
            access_token,
            refresh_token,
            scope,
            unionid,
            created_at: now,
            updated_at: now,
          }),
        );

        await this.userRepo.update(existingUser.id, {
          login_at: now,
          avatar: avatar || existingUser.avatar,
          last_login_ip: clientIp,
        });

        const token = this.auth.createToken(Number(existingUser.id));
        const groupIds = await this.getGroupIds(Number(existingUser.id));

        return {
          token,
          user: this.buildUserJson(existingUser, groupIds),
        };
      }
    }

    // Create new user
    const now = new Date();
    const randomPassword = makePassword(randomString(16));
    const randomEmail = email || `${openid}@oauth.local`;

    const newUser = await this.userRepo.save(
      this.userRepo.create({
        password: randomPassword,
        email: randomEmail,
        avatar,
        student_id: student_id || '',
        mobile: mobile || '',
        realname: nickname,
        login_at: now,
        last_login_ip: clientIp,
        register_ip: clientIp,
        created_at: now,
        updated_at: now,
      }),
    ) as User;

    // Create OAuth binding
    await this.userOauthRepo.save(
      this.userOauthRepo.create({
        user_id: Number(newUser.id),
        oauth_type: oauthType,
        openid,
        nickname,
        avatar,
        access_token,
        refresh_token,
        scope,
        unionid,
        created_at: now,
        updated_at: now,
      }),
    );

    // Add to default group
    const defaultGroup = await this.groupRepo.findOne({
      where: { is_default: true },
    });
    if (defaultGroup) {
      await this.userGroupRepo.save(
        this.userGroupRepo.create({
          user_id: Number(newUser.id),
          group_id: Number(defaultGroup.id),
          created_at: now,
          updated_at: now,
        }),
      );
    }

    const token = this.auth.createToken(Number(newUser.id));
    const groupIds = await this.getGroupIds(Number(newUser.id));

    return {
      token,
      user: this.buildUserJson(newUser, groupIds),
    };
  }

  /**
   * Bind OAuth account to current logged-in user
   */
  async bind(body: OauthBindBody, userId: number): Promise<Record<string, unknown>> {
    const code = body.code ?? '';
    const oauthType = Number(body.oauth_type) || 0;

    if (!code) {
      throw Biz.invalidArgument('code不能为空');
    }
    if (!oauthType || !OAUTH_TYPE_TO_CATEGORY[oauthType]) {
      throw Biz.invalidArgument('未知授权类型');
    }

    const category = OAUTH_TYPE_TO_CATEGORY[oauthType];
    const client_id = this.config.get(category, 'client_id');
    const client_secret = this.config.get(category, 'client_secret');
    const redirect_url = this.config.get(category, 'redirect_url');

    if (!client_id || !client_secret) {
      throw Biz.internal('OAuth配置不完整');
    }

    const tokenData = await this.exchangeCodeForToken(
      oauthType,
      code,
      client_id,
      client_secret,
      redirect_url,
    );

    const access_token = tokenData.access_token || '';
    const refresh_token = tokenData.refresh_token || '';
    const scope = tokenData.scope || '';
    const openid = tokenData.openid || tokenData.sub || tokenData.id || '';

    if (!access_token || !openid) {
      throw Biz.internal('获取用户标识失败');
    }

    const userInfo = await this.getUserInfo(oauthType, access_token, openid);
    const nickname = userInfo.nickname || userInfo.name || userInfo.login || '';
    const avatar = userInfo.avatar || userInfo.avatar_url || userInfo.picture || '';
    const unionid = userInfo.unionid || '';

    // Check if already bound
    const existingOauth = await this.userOauthRepo.findOne({
      where: { oauth_type: oauthType, openid },
    });
    if (existingOauth) {
      if (Number(existingOauth.user_id) !== userId) {
        throw Biz.alreadyExists('该第三方账号已绑定其他用户');
      }
      throw Biz.alreadyExists('该第三方账号已绑定');
    }

    const now = new Date();
    await this.userOauthRepo.save(
      this.userOauthRepo.create({
        user_id: userId,
        oauth_type: oauthType,
        openid,
        nickname,
        avatar,
        access_token,
        refresh_token,
        scope,
        unionid,
        created_at: now,
        updated_at: now,
      }),
    );

    return {};
  }

  /**
   * Exchange authorization code for access token
   */
  private async exchangeCodeForToken(
    oauthType: number,
    code: string,
    client_id: string,
    client_secret: string,
    redirect_url: string,
    codeVerifier?: string,
  ): Promise<Record<string, string>> {
    const category = OAUTH_TYPE_TO_CATEGORY[oauthType];

    if (category === 'oauthCustom') {
      const token_url = this.config.get(category, 'token_url');
      if (!token_url) {
        throw Biz.internal('自定义OAuth未配置token_url');
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
      console.log('[OAuth] token response data keys:', Object.keys(data), 'data:', JSON.stringify(data));

      // Try to extract openid from JWT payload (sub field)
      let openid = data.openid || data.sub || data.id || '';
      if (!openid && data.access_token) {
        try {
          const parts = data.access_token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
            openid = payload.sub || payload.id || '';
            console.log('[OAuth] extracted openid from JWT payload:', openid);
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
      };
    }

    // Built-in OAuth providers
    let token_url = '';
    let params: URLSearchParams;

    switch (oauthType) {
      case OAUTH_TYPE_QQ:
        token_url = 'https://graph.qq.com/oauth2.0/token';
        params = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id,
          client_secret,
          redirect_uri: redirect_url,
          fmt: 'json',
        });
        break;

      case OAUTH_TYPE_WECHAT:
      case OAUTH_TYPE_OFFICIAL_ACCOUNT:
        token_url = 'https://api.weixin.qq.com/sns/oauth2/access_token';
        params = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          appid: client_id,
          secret: client_secret,
        });
        break;

      case OAUTH_TYPE_GITEE:
        token_url = 'https://gitee.com/oauth/token';
        params = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id,
          client_secret,
          redirect_uri: redirect_url,
        });
        break;

      case OAUTH_TYPE_GITHUB:
        token_url = 'https://github.com/login/oauth/access_token';
        params = new URLSearchParams({
          client_id,
          client_secret,
          code,
          redirect_uri: redirect_url,
        });
        break;

      case OAUTH_TYPE_GOOGLE:
        token_url = 'https://oauth2.googleapis.com/token';
        params = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id,
          client_secret,
          redirect_uri: redirect_url,
        });
        break;

      default:
        throw Biz.invalidArgument('不支持的OAuth类型');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (oauthType === OAUTH_TYPE_GITHUB) {
      headers['Accept'] = 'application/json';
    }

    const response = await fetch(token_url, {
      method: 'POST',
      headers,
      body: params.toString(),
    });

    if (!response.ok) {
      throw Biz.internal(`获取token失败: ${response.status}`);
    }

    let data: any;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      const searchParams = new URLSearchParams(text);
      data = Object.fromEntries(searchParams.entries());
    }

    const access_token = data.access_token || '';

    // For QQ, need extra step to get openid
    let openid = data.openid || data.sub || data.id || '';
    if (oauthType === OAUTH_TYPE_QQ && access_token) {
      openid = await this.getQQOpenid(access_token);
    }

    return {
      access_token,
      refresh_token: data.refresh_token || '',
      scope: data.scope || '',
      openid,
    };
  }

  /**
   * Get QQ openid from access token
   */
  private async getQQOpenid(access_token: string): Promise<string> {
    const response = await fetch(
      `https://graph.qq.com/oauth2.0/me?access_token=${access_token}&fmt=json`,
    );
    if (!response.ok) {
      throw Biz.internal('获取QQ openid失败');
    }
    const data = await response.json();
    return data.openid || '';
  }

  /**
   * Get user info from OAuth provider
   */
  private async getUserInfo(
    oauthType: number,
    access_token: string,
    openid: string,
  ): Promise<Record<string, string>> {
    const category = OAUTH_TYPE_TO_CATEGORY[oauthType];

    if (category === 'oauthCustom') {
      const userinfo_url = this.config.get(category, 'userinfo_url');
      if (!userinfo_url) {
        throw Biz.internal('自定义OAuth未配置userinfo_url');
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

    // Built-in providers
    let userinfo_url = '';
    let headers: Record<string, string> = {};

    switch (oauthType) {
      case OAUTH_TYPE_QQ:
        userinfo_url = `https://graph.qq.com/user/get_user_info?access_token=${access_token}&oauth_consumer_key=${this.config.get(category, 'client_id')}&openid=${openid}`;
        break;

      case OAUTH_TYPE_WECHAT:
      case OAUTH_TYPE_OFFICIAL_ACCOUNT:
        userinfo_url = `https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}`;
        break;

      case OAUTH_TYPE_GITEE:
        userinfo_url = 'https://gitee.com/api/v5/user';
        headers = { Authorization: `Bearer ${access_token}` };
        break;

      case OAUTH_TYPE_GITHUB:
        userinfo_url = 'https://api.github.com/user';
        headers = { Authorization: `Bearer ${access_token}` };
        break;

      case OAUTH_TYPE_GOOGLE:
        userinfo_url = 'https://www.googleapis.com/oauth2/v2/userinfo';
        headers = { Authorization: `Bearer ${access_token}` };
        break;

      default:
        throw Biz.invalidArgument('不支持的OAuth类型');
    }

    const response = await fetch(userinfo_url, { headers });
    if (!response.ok) {
      throw Biz.internal(`获取用户信息失败: ${response.status}`);
    }

    return await response.json();
  }

  private async getGroupIds(userId: number): Promise<number[]> {
    const rows = await this.userGroupRepo.find({ where: { user_id: userId } });
    return rows.map((r) => Number(r.group_id)).filter((id) => id > 0);
  }

  /**
   * SSO：校验浏览器带入的 user-center 共享 access_token cookie（Cookie 真源）。
   * 用 user-center RS256 公钥校验其 JWT，提取 sub（user-center 用户标识）→ 经 UserOauth 绑定
   * 定位 lib 本地用户 → 签发 lib token。无 cookie / 校验失败 / 未绑定 → 静默返回 { valid:false }，不建账号。
   */
  async ssoSession(req: Request): Promise<Record<string, unknown>> {
    let token = this.readCookie(req, 'access_token');
    if (!token) {
      // 共享 access_token cookie 缺失：无法仅凭"缺 cookie"判断是 user-center 确证登出
      // 还是共享 cookie 未落地/被跨域转发拦截。向 user-center /auth/session-state 做正向确认：
      // - has_session=true（登录仍有效）→ 判为 cookie 未落地，保留本地会话（防"登录即退/切标签即退"）；
      // - has_session=false（确证登出）→ valid:false 硬登出，恢复 user 登出 → lib 立即登出；
      // - 不可达/异常 → 返回 degraded，交前端按降级窗口处置，不误踢。
      const ucAlive = await this.probeUcSessionState(req);
      if (ucAlive === true) return { valid: true, degraded: true };
      if (ucAlive === false) return { valid: false, reason: 'no-cookie' };
      return { valid: true, degraded: true };
    }

    // 实时校验 + 自动续期：access_token 过期（签名有效）时，用父域 refresh_token 经
    // user-center /oauth/token 的 refresh_token grant 静默换新令牌，保证全站长在线。
    // 仅"签名有效但过期"才可安全续期；签名被篡改 / 无 refresh_token 一律拒绝。
    // user-center 不可达（网络失败 / JWKS 拉不到）时返回 degraded，交前端按 15 分钟降级窗口处置。
    let degraded = false;
    let refreshedTokens: { access_token: string; refresh_token: string } | null = null;

    let verify = await this.verifyUcToken(token);
    if (!verify.ok) {
      if (verify.unreachable) {
        degraded = true;
      } else if (verify.expired) {
        const rt = this.readCookie(req, 'refresh_token');
        if (rt) {
          const refresh = await this.tryRefreshUc(rt);
          if (refresh && refresh.reachable) {
            refreshedTokens = {
              access_token: refresh.access_token,
              refresh_token: refresh.refresh_token || '',
            };
            token = refresh.access_token;
            verify = await this.verifyUcToken(token);
            if (!verify.ok) return { valid: false, reason: 'invalid-token' };
          } else if (refresh && refresh.reachable === false) {
            degraded = true;
          } else {
            // user-center 可达但 refresh 被拒（轮换令牌已失效/被吊销）→ 会话确证失效
            return { valid: false, reason: 'no-refresh' };
          }
        } else {
          return { valid: false, reason: 'no-refresh' };
        }
      } else {
        return { valid: false, reason: 'invalid-token' };
      }
    }

    const payload = verify.payload;
    if (!payload) return { valid: false, reason: 'no-sub' };
    // user-center 不可达：无法确证会话，交前端按 15 分钟降级窗口决定是否保留本地会话
    if (degraded) return { valid: true, degraded: true };

    const ucSubject = String(payload?.sub || payload?.openid || '');
    if (!ucSubject) return { valid: false, reason: 'no-sub' };

    const binding = await this.userOauthRepo.findOne({
      where: { oauth_type: OAUTH_TYPE_CUSTOM, openid: ucSubject },
    });
    if (!binding) {
      // 新用户：从未在 lib 绑定（oauth_type=6/openid 无记录），自动建本地账号并绑定，
      // 实现"user 新用户也能自动登录 lib"。尽力拉取 user-center 用户信息作昵称/头像，失败不阻塞登录。
      let nickname = '';
      let avatar = '';
      let email = '';
      let student_id = '';
      let phone = '';
      let ssoInfo: any = null;
      try {
        const info: any = await this.getUserInfo(OAUTH_TYPE_CUSTOM, token, ucSubject);
        ssoInfo = info;
        nickname = info?.nickname || info?.name || info?.login || '';
        avatar = info?.avatar || info?.avatar_url || info?.picture || '';
        email = info?.email || '';
        student_id = String(info?.student_id || '');
        phone = String(info?.phone || '');
      } catch {
        /* 拉取失败仅缺昵称头像 */
      }
      // 方案2：实时校验 user 状态，封禁/删除账号拒绝 SSO 登录（拉取失败视为活跃，避免误杀）
      if (ssoInfo && !this.isUcUserActive(ssoInfo)) {
        return { valid: false, reason: 'user-inactive' };
      }
      try {
        // user-center 真实邮箱优先写入新账号（users.email 唯一索引）；被 lib 其它账号占用时
        // 降级 openid 派生邮箱。skipEmailBind=true 屏蔽"按 email 绑到现有账号"，避免误关联。
        let bindEmail = '';
        if (email) {
          const clash: any = await this.userRepo.findOne({ where: { email } }).catch(() => null);
          if (!clash) bindEmail = email;
        }
        const bound = await this.matchOrCreateUser({
          oauthType: OAUTH_TYPE_CUSTOM,
          openid: ucSubject,
          access_token: token,
          refresh_token: '',
          scope: '',
          unionid: '',
          nickname,
          avatar,
          email: bindEmail,
          student_id,
          mobile: phone,
          clientIp: req.ip,
        }, { skipEmailBind: true });
        const newUserRet: any = { valid: true, token: bound.token, user: bound.user };
        if (refreshedTokens) newUserRet.refresh = refreshedTokens;
        return newUserRet;
      } catch (e) {
        console.error('[SSO] auto-bind new user failed:', (e as Error)?.message);
        return { valid: false, reason: 'bind-failed' };
      }
    }

    const user = await this.userRepo.findOne({ where: { id: binding.user_id } });
    if (!user) return { valid: false, reason: 'no-user' };

    // 同步 user-center 学号到 lib 用户，保证「学号」展示真实值（失败不回退登录）
    try {
      const info: any = await this.getUserInfo(OAUTH_TYPE_CUSTOM, token, ucSubject);
      // 方案2：实时校验 user 状态，封禁/删除账号拒绝 SSO 登录
      if (info && !this.isUcUserActive(info)) {
        return { valid: false, reason: 'user-inactive' };
      }
      const freshStudid = String(info?.student_id || '').trim();
      if (freshStudid && freshStudid !== user.student_id) {
        user.student_id = freshStudid;
        await this.userRepo.update(user.id, { student_id: freshStudid });
      }
      const freshPhone = String(info?.phone || '').trim();
      if (freshPhone && freshPhone !== user.mobile) {
        user.mobile = freshPhone;
        await this.userRepo.update(user.id, { mobile: freshPhone });
      }
      // uc 为真源：同步头像
      const freshAvatar = String(info?.avatar || '');
      if (freshAvatar && freshAvatar !== user.avatar) {
        user.avatar = freshAvatar;
        await this.userRepo.update(user.id, { avatar: freshAvatar });
      }
    } catch {
      /* 同步失败仅少一次刷新 */
    }

    const token2 = this.auth.createToken(Number(user.id));
    const groupIds = await this.getGroupIds(Number(user.id));
    const ret: any = {
      valid: true,
      token: token2,
      user: this.buildUserJson(user, groupIds),
    };
    if (refreshedTokens) ret.refresh = refreshedTokens;
    return ret;
  }

  /** 用 user-center JWKS 公钥校验其 access_token，并区分「签名有效但过期」与「IdP 不可达」。 */
  private async verifyUcToken(
    token: string,
  ): Promise<{ ok: boolean; expired?: boolean; unreachable?: boolean; payload?: any }> {
    let kid: string | undefined;
    try {
      kid = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))?.kid;
    } catch {
      /* ignore */
    }
    const publicKey = await this.jwks.getPublicKey(kid);
    // 拉不到公钥（JWKS 未配置或刷新失败且无缓存）→ 视为 user-center 不可达，交降级窗口
    if (!publicKey) return { ok: false, unreachable: true };
    try {
      const payload = this.jwtService.verify(token, {
        publicKey,
        algorithms: ['RS256'],
        ignoreExpiration: false,
        issuer: 'shanhe-auth',
        audience: 'shanhe-users',
      });
      return { ok: true, payload };
    } catch (e: any) {
      // 仅 TokenExpiredError 表明签名有效但已过期，可安全走 refresh 续期
      return { ok: false, expired: e?.name === 'TokenExpiredError' };
    }
  }

  /** 用父域 refresh_token 经 user-center /oauth/token 换新令牌；网络失败返回 reachable=false。 */
  private async tryRefreshUc(
    refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string; reachable: boolean } | null> {
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
      return { access_token: '', refresh_token: '', reachable: false };
    }
    if (!response || !response.ok) return null; // user-center 可达但 refresh 被拒
    const data: any = await response.json().catch(() => ({}));
    if (!data?.access_token) return null;
    return {
      access_token: String(data.access_token),
      refresh_token: String(data.refresh_token || ''),
      reachable: true,
    };
  }

  /**
   * 向 user-center /auth/session-state 正向确认是否存在有效会话（OAuth/SSO 跨站 SLO）。
   * 把浏览器携带的共享 cookie（refresh_token 等，均在 .shanhe.co 域内）原样转发给 user-center，
   * 由其判定该身份是否仍在线。返回：
   * - true  ：user-center 有会话（has_session=true）→ 本地应保留；
   * - false ：user-center 确证无会话（has_session=false）→ 本地应登出；
   * - null  ：user-center 不可达 / 响应异常 → 无法确证，调用方应按不可达处理。
   */
  private async probeUcSessionState(req: Request): Promise<boolean | null> {
    try {
      const ucBase = this.ucBase();
      const sessionStateUrl = `${ucBase.replace(/\/$/, '')}/auth/session-state`;
      const cookie = String(req.headers['cookie'] || '');
      const res = await fetch(sessionStateUrl, {
        headers: cookie ? { cookie } : {},
        signal: AbortSignal.timeout(6000),
      });
      if (!res || !res.ok) return null;
      const data: any = await res.json().catch(() => null);
      if (!data || typeof data.has_session !== 'boolean') return null;
      return data.has_session;
    } catch {
      // 不可达/超时：无法确证，交调用方按降级处理
      return null;
    }
  }

  /** 用户是否活跃：uc userinfo 的 status；为空(兼容未返回)视为活跃，'active' 活跃，其余(disabled/banned)拒绝 */
  private isUcUserActive(info: any): boolean {
    const status = String(info?.status || '');
    return !status || status === 'active';
  }

  private readCookie(req: Request, name: string): string {
    const raw = req.headers.cookie || '';
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
    }
    return '';
  }

  private buildUserJson(user: User, groupIds: number[] = []): Record<string, unknown> {
    return {
      id: Number(user.id),
      mobile: user.mobile,
      email: user.email,
      address: user.address,
      signature: user.signature,
      last_login_ip: user.last_login_ip,
      register_ip: user.register_ip,
      doc_count: user.doc_count,
      follow_count: user.follow_count,
      fans_count: user.fans_count,
      favorite_count: user.favorite_count,
      comment_count: user.comment_count,
      credit_count: user.credit_count,
      article_count: user.article_count,
      avatar: user.avatar,
      student_id: user.student_id,
      realname: user.realname,
      login_at: user.login_at,
      created_at: user.created_at,
      updated_at: user.updated_at,
      group_id: groupIds,
    };
  }
}
