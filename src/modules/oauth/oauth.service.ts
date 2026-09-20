import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserGroup, Group, UserOauth } from '../../entities';
import { ConfigService } from '../../config/config.service';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import { JwksService } from './jwks.service';
import { Biz } from '../../common/biz.exception';
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

      oauths.push(oauth);
    }

    return { oauths };
  }

  /**
   * OAuth login: exchange code for token, get user info, create/match local user
   */
  async login(body: OauthLoginBody): Promise<{
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
    });
  }

  /**
   * 直接登录（ROPC）：用 user-center 账号密码换 token，不经过授权页。
   * 请求 user-center token 端点的 password grant，再取用户信息并匹配/创建本地用户。
   * 仅当 custom（user-center）客户端为 confidential 且启用时可用。
   */
  async passwordLogin(body: PasswordLoginBody): Promise<Record<string, unknown>> {
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
    });
    // 把 user-center 的 access_token 一并带出，供 controller 写共享 .shanhe.co cookie（Cookie 真源 SSO）
    return { ...loginResult, uc_access_token: access_token };
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
        realname: nickname,
        login_at: now,
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
    const token = this.readCookie(req, 'access_token');
    if (!token) return { valid: false, reason: 'no-cookie' };

    let kid: string | undefined;
    try {
      const header = token.split('.')[0];
      if (header) {
        const parsed = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
        kid = parsed?.kid;
      }
    } catch {
      /* ignore */
    }

    const publicKey = await this.jwks.getPublicKey(kid);
    if (!publicKey) return { valid: false, reason: 'no-jwks' };

    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        publicKey,
        algorithms: ['RS256'],
        ignoreExpiration: false,
      });
    } catch {
      return { valid: false, reason: 'invalid-token' };
    }

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
      try {
        const info: any = await this.getUserInfo(OAUTH_TYPE_CUSTOM, token, ucSubject);
        nickname = info?.nickname || info?.name || info?.login || '';
        avatar = info?.avatar || info?.avatar_url || info?.picture || '';
        email = info?.email || '';
      } catch {
        /* 拉取失败仅缺昵称头像 */
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
        }, { skipEmailBind: true });
        return { valid: true, token: bound.token, user: bound.user };
      } catch (e) {
        console.error('[SSO] auto-bind new user failed:', (e as Error)?.message);
        return { valid: false, reason: 'bind-failed' };
      }
    }

    const user = await this.userRepo.findOne({ where: { id: binding.user_id } });
    if (!user) return { valid: false, reason: 'no-user' };

    const token2 = this.auth.createToken(Number(user.id));
    const groupIds = await this.getGroupIds(Number(user.id));
    return {
      valid: true,
      token: token2,
      user: this.buildUserJson(user, groupIds),
    };
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
      identity: user.identity,
      realname: user.realname,
      login_at: user.login_at,
      created_at: user.created_at,
      updated_at: user.updated_at,
      group_id: groupIds,
    };
  }
}
