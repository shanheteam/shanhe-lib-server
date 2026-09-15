import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserGroup, Group, UserOauth } from '../../entities';
import { ConfigService } from '../../config/config.service';
import { AuthService } from '../../auth/auth.service';
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
  [OAUTH_TYPE_CUSTOM]: '自定义',
  [OAUTH_TYPE_GOOGLE]: '谷歌',
  [OAUTH_TYPE_OFFICIAL_ACCOUNT]: '公众号',
};

interface OauthLoginBody {
  code?: string;
  oauth_type?: number;
}

interface OauthBindBody {
  code?: string;
  oauth_type?: number;
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

      // For custom OAuth, include extra fields
      if (category === 'oauthCustom') {
        oauth.authorize_url = this.config.get(category, 'authorize_url');
        oauth.token_url = this.config.get(category, 'token_url');
        oauth.userinfo_url = this.config.get(category, 'userinfo_url');
        oauth.scope = this.config.get(category, 'scope');
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
    const code = body.code ?? '';
    const oauthType = Number(body.oauth_type) || 0;

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

    // Exchange code for access token
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

    // Get user info from OAuth provider
    const userInfo = await this.getUserInfo(oauthType, access_token, openid);

    const nickname = userInfo.nickname || userInfo.name || userInfo.login || '';
    const avatar = userInfo.avatar || userInfo.avatar_url || userInfo.picture || '';
    const email = userInfo.email || '';
    const unionid = userInfo.unionid || '';

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

    // New OAuth account - check if email matches existing user
    if (email) {
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

      const response = await fetch(token_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) {
        throw Biz.internal(`获取token失败: ${response.status}`);
      }

      const data = await response.json();
      return {
        access_token: data.access_token || '',
        refresh_token: data.refresh_token || '',
        scope: data.scope || '',
        openid: data.openid || data.sub || data.id || '',
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

      const response = await fetch(userinfo_url, {
        headers: { Authorization: `Bearer ${access_token}` },
      });

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
