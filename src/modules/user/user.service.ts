import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  User,
  UserGroup,
  Group,
  GroupPermission,
  Permission,
  Download,
  Dynamic,
  Sign,
  EmailCode,
  Logout,
} from '../../entities';
import { Biz } from '../../common/biz.exception';
import { checkPassword, makePassword, randomString } from '../../common/password.util';
import { ConfigService } from '../../config/config.service';
import { AuthService } from '../../auth/auth.service';
import { PermissionService } from '../../auth/permission.service';
import { CaptchaService } from '../captcha/captcha.service';
import { JwtUser } from '../../auth/jwt-user.type';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMAIL_CODE_REGISTER = 0;
const EMAIL_CODE_LOGIN = 1;
const EMAIL_CODE_FIND_PASSWORD = 2;

const DYNAMIC_TYPE_REGISTER = 6;
const DYNAMIC_TYPE_SIGN = 11;

// 用户公开字段（非管理员查询他人资料时仅返回这些字段）
const PUBLIC_FIELDS = [
  'id',
  'avatar',
  'signature',
  'doc_count',
  'follow_count',
  'fans_count',
  'favorite_count',
  'comment_count',
  'credit_count',
  'article_count',
  'created_at',
  'updated_at',
  'login_at',
];

interface RegisterBody {
  password?: string;
  captcha?: string;
  captcha_id?: string;
  email?: string;
  code?: string;
}

interface UpdatePasswordBody {
  id?: number;
  old_password?: string;
  new_password?: string;
}

interface ProfileBody {
  id?: number;
  mobile?: string;
  email?: string;
  address?: string;
  signature?: string;
  avatar?: string;
  realname?: string;
  identity?: string;
  remark?: string;
}

interface DeleteBody {
  id?: number[];
  password?: string;
}

interface SetUserBody {
  id?: number;
  password?: string;
  email?: string;
  group_id?: number[];
}

interface ListUserQuery {
  page?: string | number;
  size?: string | number;
  wd?: string;
  id?: string | string[] | number | number[];
  group_id?: string | string[] | number | number[];
}

interface FindPasswordBody {
  email?: string;
  password?: string;
  captcha?: string;
  captcha_id?: string;
  code?: string;
  token?: string;
}

interface SendEmailCodeBody {
  email?: string;
  captcha?: string;
  captcha_id?: string;
  type?: number;
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserGroup)
    private readonly userGroupRepo: Repository<UserGroup>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(GroupPermission)
    private readonly groupPermissionRepo: Repository<GroupPermission>,
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(Download)
    private readonly downloadRepo: Repository<Download>,
    @InjectRepository(Dynamic)
    private readonly dynamicRepo: Repository<Dynamic>,
    @InjectRepository(Sign)
    private readonly signRepo: Repository<Sign>,
    @InjectRepository(EmailCode)
    private readonly emailCodeRepo: Repository<EmailCode>,
    @InjectRepository(Logout)
    private readonly logoutRepo: Repository<Logout>,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly permissionService: PermissionService,
    private readonly captcha: CaptchaService,
  ) {}

  // ---------- 工具方法 ----------

  private isValidEmail(email: string): boolean {
    return !!email && EMAIL_RE.test(email);
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

  private buildPublicUserJson(user: User, groupIds: number[] = []): Record<string, unknown> {
    const full = this.buildUserJson(user, groupIds);
    const out: Record<string, unknown> = {};
    for (const field of PUBLIC_FIELDS) out[field] = full[field];
    out.group_id = groupIds;
    return out;
  }

  private async getGroupIds(userId: number): Promise<number[]> {
    const rows = await this.userGroupRepo.find({ where: { user_id: userId } });
    return rows.map((r) => Number(r.group_id)).filter((id) => id > 0);
  }

  private emailServiceConfigured(): boolean {
    return this.config.getBool('email', 'enable') && this.config.get('email', 'host') !== '';
  }

  private captchaEnabled(type: string): boolean {
    switch (type) {
      case 'register':
        return this.config.getBool('security', 'enable_captcha_register');
      case 'login':
        return this.config.getBool('security', 'enable_captcha_login');
      case 'find_password':
        return this.config.getBool('security', 'enable_captcha_find_password');
      case 'comment':
        return this.config.getBool('security', 'enable_captcha_comment');
      default:
        throw Biz.invalidArgument('不支持的验证码类型');
    }
  }

  private todaySignAt(): number {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return Number(`${now.getFullYear()}${mm}${dd}`);
  }

  private async sendCodeAndStore(
    email: string,
    codeType: number,
    ip: string,
  ): Promise<void> {
    if (!this.emailServiceConfigured()) {
      throw Biz.invalidArgument('未配置邮箱服务');
    }
    const code = randomString(6);
    await this.emailCodeRepo.save(
      this.emailCodeRepo.create({
        email,
        ip: ip || '',
        code,
        code_type: codeType,
        success: true,
        error: '',
        is_used: false,
        created_at: new Date(),
        updated_at: new Date(),
      }),
    );
  }

  // ---------- 注册 / 登录 ----------

  async register(body: RegisterBody, ip = ''): Promise<{ token: string; user: Record<string, unknown> }> {
    const password = body.password ?? '';
    const email = String(body.email ?? '').trim();

    if (password.length < 6) {
      throw Biz.invalidArgument('密码长度不能小于6位');
    }
    if (!this.isValidEmail(email)) {
      throw Biz.invalidArgument('邮箱格式不正确');
    }

    if (this.config.getBool('security', 'enable_captcha_register')) {
      if (!body.captcha_id || !body.captcha) {
        throw Biz.invalidArgument('请输入验证码');
      }
      if (!this.captcha.verify(body.captcha_id, body.captcha, true)) {
        throw Biz.invalidArgument('验证码错误');
      }
    }

    const existEmail = await this.userRepo.findOne({ where: { email } });
    if (existEmail) {
      throw Biz.alreadyExists('邮箱已存在');
    }

    const credit = this.config.getInt('score', 'register', 0);
    const now = new Date();
    const saved = await this.userRepo.save(
      this.userRepo.create({
        password: makePassword(password),
        email,
        register_ip: ip || '',
        last_login_ip: ip || '',
        login_at: now,
        credit_count: credit,
        created_at: now,
        updated_at: now,
      }),
    );

    // 注册默认加入「普通用户」组；不存在默认组则不加入
    const defaultGroup = await this.groupRepo.findOne({ where: { is_default: true } });
    if (defaultGroup) {
      await this.userGroupRepo.save(
        this.userGroupRepo.create({
          user_id: Number(saved.id),
          group_id: Number(defaultGroup.id),
          created_at: now,
          updated_at: now,
        }),
      );
    }

    if (credit > 0) {
      await this.dynamicRepo.save(
        this.dynamicRepo.create({
          user_id: Number(saved.id),
          type: DYNAMIC_TYPE_REGISTER,
          content: `成功注册成网站会员，获得 ${credit} 积分奖励`,
          created_at: now,
          updated_at: now,
        }),
      );
    }

    const token = this.auth.createToken(Number(saved.id));
    const groupIds = await this.getGroupIds(Number(saved.id));
    return { token, user: this.buildUserJson(saved, groupIds) };
  }

  async login(body: RegisterBody, ip = ''): Promise<{ token: string; user: Record<string, unknown> }> {
    const email = String(body.email ?? '').trim();
    const password = body.password ?? '';

    if (this.config.getBool('security', 'enable_captcha_login')) {
      if (!body.captcha_id || !body.captcha) {
        throw Biz.invalidArgument('请输入验证码');
      }
      if (!this.captcha.verify(body.captcha_id, body.captcha, true)) {
        throw Biz.invalidArgument('验证码错误');
      }
    }

    const user = await this.userRepo.findOne({
      where: { email },
    });
    if (!user || !checkPassword(password, user.password)) {
      throw Biz.invalidArgument('邮箱或密码不正确');
    }

    await this.userRepo.update(user.id, {
      login_at: new Date(),
      last_login_ip: ip || '',
    });

    const token = this.auth.createToken(Number(user.id));
    const groupIds = await this.getGroupIds(Number(user.id));
    const fresh = await this.userRepo.findOne({ where: { id: user.id } });
    return { token, user: this.buildUserJson(fresh || user, groupIds) };
  }

  async logout(user: JwtUser): Promise<Record<string, never>> {
    await this.logoutRepo.save(
      this.logoutRepo.create({
        user_id: user.userId,
        uuid: user.uuid,
        expired_at: user.exp ?? 0,
        created_at: new Date(),
      }),
    );
    return {};
  }

  // ---------- 用户信息 ----------

  async getUser(queryId: number | undefined, user: JwtUser | undefined): Promise<Record<string, unknown>> {
    let id = Number(queryId) || 0;
    if (id <= 0) {
      if (!user) {
        throw Biz.invalidArgument('ID错误');
      }
      id = user.userId;
    }

    const target = await this.userRepo.findOne({ where: { id } });
    if (!target) {
      throw Biz.notFound('用户不存在');
    }

    const groupIds = await this.getGroupIds(id);
    const isAdmin = user ? await this.permissionService.isAdmin(user.userId) : false;
    const isSelf = user ? user.userId === id : false;

    return isAdmin || isSelf
      ? this.buildUserJson(target, groupIds)
      : this.buildPublicUserJson(target, groupIds);
  }

  async updateUserPassword(body: UpdatePasswordBody, user: JwtUser): Promise<Record<string, never>> {
    const newPassword = body.new_password ?? '';
    if (newPassword.length < 6) {
      throw Biz.invalidArgument('密码长度不能小于6位');
    }

    const targetId = Number(body.id) || 0;

    // 修改自己的密码：验证旧密码
    if (targetId <= 0 || targetId === user.userId) {
      const existUser = await this.userRepo.findOne({ where: { id: user.userId } });
      if (!existUser) {
        throw Biz.unauthenticated('用户不存在');
      }
      if (!checkPassword(body.old_password ?? '', existUser.password)) {
        throw Biz.invalidArgument('原密码不正确');
      }
      await this.userRepo.update(user.userId, {
        password: makePassword(newPassword),
        updated_at: new Date(),
      });
      return {};
    }

    // 管理员重置他人密码：需要权限
    const ok = await this.permissionService.check(user.userId, '/api.v1.UserAPI/UpdateUserPassword');
    if (!ok) {
      throw Biz.permissionDenied('您没有权限重置他人密码');
    }
    await this.userRepo.update(targetId, {
      password: makePassword(newPassword),
      updated_at: new Date(),
    });
    return {};
  }

  async updateUserProfile(body: ProfileBody, user: JwtUser): Promise<Record<string, never>> {
    const isAdmin = await this.permissionService.isAdmin(user.userId);
    let targetId = Number(body.id) || user.userId;
    if (!isAdmin && targetId !== user.userId) {
      throw Biz.permissionDenied('您没有权限更改他人信息');
    }
    if (targetId <= 0) targetId = user.userId;

    const patch: Partial<User> = {};
    const fields = ['mobile', 'email', 'address', 'signature', 'avatar', 'realname', 'identity'] as const;
    for (const field of fields) {
      const value = (body as any)[field];
      if (value !== undefined) (patch as any)[field] = value;
    }
    if (isAdmin && body.remark !== undefined) {
      patch.remark = body.remark;
    }
    patch.updated_at = new Date();

    await this.userRepo.update(targetId, patch);
    return {};
  }

  async deleteUser(body: DeleteBody, user: JwtUser): Promise<Record<string, never>> {
    const admin = await this.userRepo.findOne({ where: { id: user.userId } });
    if (!admin) {
      throw Biz.unauthenticated('用户不存在');
    }
    if (!checkPassword(body.password ?? '', admin.password)) {
      throw Biz.invalidArgument('密码错误');
    }

    const ids = (body.id ?? []).map((v) => Number(v)).filter((v) => v > 0);
    if (ids.length === 0) {
      throw Biz.invalidArgument('ID错误');
    }

    await this.userGroupRepo.delete({ user_id: In(ids) });
    await this.userRepo.delete(ids);
    return {};
  }

  async addUser(body: SetUserBody): Promise<Record<string, never>> {
    const password = body.password ?? '';
    const email = String(body.email ?? '').trim();
    const groupIds = (body.group_id ?? []).map((v) => Number(v)).filter((v) => v > 0);

    if (password.length < 6) {
      throw Biz.invalidArgument('密码长度不能小于6位');
    }
    if (!this.isValidEmail(email)) {
      throw Biz.invalidArgument('邮箱格式不正确');
    }
    if (groupIds.length === 0) {
      throw Biz.invalidArgument('用户组不能为空');
    }

    const existEmail = await this.userRepo.findOne({ where: { email } });
    if (existEmail) {
      throw Biz.invalidArgument('邮箱已存在');
    }

    const now = new Date();
    const saved = await this.userRepo.save(
      this.userRepo.create({
        password: makePassword(password),
        email,
        created_at: now,
        updated_at: now,
      }),
    );

    for (const groupId of groupIds) {
      await this.userGroupRepo.save(
        this.userGroupRepo.create({
          user_id: Number(saved.id),
          group_id: groupId,
          created_at: now,
          updated_at: now,
        }),
      );
    }

    return {};
  }

  async setUser(body: SetUserBody): Promise<Record<string, never>> {
    const targetId = Number(body.id) || 0;
    const groupIds = (body.group_id ?? []).map((v) => Number(v)).filter((v) => v > 0);

    if (targetId <= 0) {
      throw Biz.invalidArgument('ID错误');
    }
    if (groupIds.length === 0) {
      throw Biz.invalidArgument('用户组不能为空');
    }

    const now = new Date();
    await this.userGroupRepo.delete({ user_id: targetId });
    for (const groupId of groupIds) {
      await this.userGroupRepo.save(
        this.userGroupRepo.create({
          user_id: targetId,
          group_id: groupId,
          created_at: now,
          updated_at: now,
        }),
      );
    }

    if (body.password) {
      await this.userRepo.update(targetId, {
        password: makePassword(body.password),
        updated_at: now,
      });
    }

    return {};
  }

  async listUser(query: ListUserQuery): Promise<{ total: number; user: Record<string, unknown>[] }> {
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.min(100, Math.max(1, Number(query.size) || 10));

    const qb = this.userRepo.createQueryBuilder('u');

    const wd = String(query.wd ?? '').trim();
    if (wd) {
      const like = `%${wd}%`;
      qb.andWhere('(u.realname LIKE :wd OR u.email LIKE :wd OR u.mobile LIKE :wd)', { wd: like });
    }

    const ids = this.toNumArray(query.id);
    if (ids.length) {
      qb.andWhere('u.id IN (:...ids)', { ids });
    }

    const gids = this.toNumArray(query.group_id);
    if (gids.length) {
      const ugs = await this.userGroupRepo.find({ where: { group_id: In(gids) } });
      const userIds = ugs.map((x) => Number(x.user_id)).filter((n) => n > 0);
      if (userIds.length === 0) {
        return { total: 0, user: [] };
      }
      qb.andWhere('u.id IN (:...userIds)', { userIds });
    }

    qb.orderBy('u.id', 'DESC').skip((page - 1) * size).take(size);
    const [rows, total] = await qb.getManyAndCount();

    const userIds = rows.map((r) => Number(r.id));
    const ugRows = userIds.length
      ? await this.userGroupRepo.find({ where: { user_id: In(userIds) } })
      : [];
    const groupMap = new Map<number, number[]>();
    for (const ug of ugRows) {
      const uid = Number(ug.user_id);
      if (!groupMap.has(uid)) groupMap.set(uid, []);
      groupMap.get(uid)!.push(Number(ug.group_id));
    }

    const result = rows.map((r) => this.buildUserJson(r, groupMap.get(Number(r.id)) ?? []));
    return { total, user: result };
  }

  private toNumArray(v: unknown): number[] {
    const list = (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]) as unknown[];
    return list.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  }

  // ---------- 验证码 ----------

  async getUserCaptcha(type: string): Promise<{ enable: boolean; id: string; captcha: string; type: string }> {
    const enable = this.captchaEnabled(type);
    const cfgType = this.config.get('captcha', 'type', 'digit');

    if (!enable) {
      return { enable: false, id: '', captcha: '', type: cfgType };
    }

    const length = this.config.getInt('captcha', 'length', 4);
    const width = this.config.getInt('captcha', 'width', 240);
    const height = this.config.getInt('captcha', 'height', 60);
    const { id, captcha } = this.captcha.generate(cfgType, length, width, height);
    return { enable: true, id, captcha, type: cfgType };
  }

  // ---------- 用户权限与行为能力 ----------

  async getUserPermissions(user: JwtUser): Promise<{ permission: Permission[] }> {
    if (user.userId === 1) {
      const permissions = await this.permissionRepo.find();
      return { permission: permissions };
    }

    const ugs = await this.userGroupRepo.find({ where: { user_id: user.userId } });
    const gids = ugs.map((x) => Number(x.group_id)).filter((n) => n > 0);
    if (gids.length === 0) {
      return { permission: [] };
    }

    const gps = await this.groupPermissionRepo.find({ where: { group_id: In(gids) } });
    const pids = gps.map((x) => Number(x.permission_id)).filter((n) => n > 0);
    if (pids.length === 0) {
      return { permission: [] };
    }

    const permissions = await this.permissionRepo.find({ where: { id: In(pids) } });
    return { permission: permissions };
  }

  async canIUploadDocument(user: JwtUser): Promise<Record<string, never>> {
    if (user.userId === 1) return {};

    const ugs = await this.userGroupRepo.find({ where: { user_id: user.userId } });
    const gids = ugs.map((x) => Number(x.group_id)).filter((n) => n > 0);
    if (gids.length === 0) {
      throw Biz.permissionDenied('您没有上传文档的权限');
    }
    const group = await this.groupRepo.findOne({ where: { id: In(gids), enable_upload: true } });
    if (!group) {
      throw Biz.permissionDenied('您没有上传文档的权限');
    }
    return {};
  }

  async canIPublishArticle(user: JwtUser): Promise<Record<string, never>> {
    if (user.userId === 1) return {};

    const ugs = await this.userGroupRepo.find({ where: { user_id: user.userId } });
    const gids = ugs.map((x) => Number(x.group_id)).filter((n) => n > 0);
    if (gids.length === 0) {
      throw Biz.permissionDenied('您没有发布文章的权限');
    }
    const group = await this.groupRepo.findOne({ where: { id: In(gids), enable_article: true } });
    if (!group) {
      throw Biz.permissionDenied('您没有发布文章的权限');
    }
    return {};
  }

  // ---------- 动态 / 签到 / 下载 / 用户组 ----------

  async listUserDynamic(user: JwtUser, page = 1, size = 10): Promise<{ total: number; dynamic: Dynamic[] }> {
    const p = Math.max(1, page || 1);
    const s = Math.min(100, Math.max(1, size || 10));

    const qb = this.dynamicRepo.createQueryBuilder('d').where('d.user_id = :uid', { uid: user.userId });
    const [rows, total] = await qb
      .orderBy('d.id', 'DESC')
      .skip((p - 1) * s)
      .take(s)
      .getManyAndCount();

    return { total, dynamic: rows };
  }

  async getSignedToday(user: JwtUser): Promise<Sign | { id: number }> {
    const sign = await this.signRepo.findOne({
      where: { user_id: user.userId, sign_at: this.todaySignAt() },
    });
    if (!sign) {
      return { id: 0 };
    }
    return sign;
  }

  async signToday(user: JwtUser, ip = ''): Promise<Sign> {
    const existed = await this.signRepo.findOne({
      where: { user_id: user.userId, sign_at: this.todaySignAt() },
    });
    if (existed) {
      throw Biz.alreadyExists('您今天已经签到过了');
    }

    const award = this.config.getInt('score', 'sign_in', 0);
    const now = new Date();
    const sign = await this.signRepo.save(
      this.signRepo.create({
        user_id: user.userId,
        ip: ip || '',
        sign_at: this.todaySignAt(),
        award,
        created_at: now,
        updated_at: now,
      }),
    );

    if (award > 0) {
      await this.userRepo.createQueryBuilder()
        .update(User)
        .set({ credit_count: () => `credit_count + ${award}` })
        .where('id = :id', { id: user.userId })
        .execute();
    }

    const content = award > 0 ? `签到成功，获得 ${award} 积分奖励` : '完成了每日签到';
    await this.dynamicRepo.save(
      this.dynamicRepo.create({
        user_id: user.userId,
        type: DYNAMIC_TYPE_SIGN,
        content,
        created_at: now,
        updated_at: now,
      }),
    );

    return sign;
  }

  async listUserDownload(user: JwtUser, page = 1, size = 10): Promise<{ total: number; download: Download[] }> {
    const p = Math.max(1, page || 1);
    const s = Math.min(100, Math.max(1, size || 10));

    const qb = this.downloadRepo.createQueryBuilder('d').where('d.user_id = :uid', { uid: user.userId });
    const [rows, total] = await qb
      .orderBy('d.id', 'DESC')
      .skip((p - 1) * s)
      .take(s)
      .getManyAndCount();

    return { total, download: rows };
  }

  async listUserGroup(user: JwtUser): Promise<{ group: Group[] }> {
    const ugs = await this.userGroupRepo.find({ where: { user_id: user.userId } });
    const gids = ugs.map((x) => Number(x.group_id)).filter((n) => n > 0);
    if (gids.length === 0) {
      return { group: [] };
    }
    const groups = await this.groupRepo.find({ where: { id: In(gids) } });
    return { group: groups };
  }

  // ---------- 找回密码 / 邮箱验证码 ----------

  async findPasswordStepOne(body: FindPasswordBody, ip = ''): Promise<Record<string, never>> {
    const email = String(body.email ?? '').trim();
    if (!this.isValidEmail(email)) {
      throw Biz.invalidArgument('邮箱格式不正确');
    }

    if (this.config.getBool('security', 'enable_captcha_find_password')) {
      if (!body.captcha_id || !body.captcha) {
        throw Biz.invalidArgument('请输入验证码');
      }
      if (!this.captcha.verify(body.captcha_id, body.captcha, false)) {
        throw Biz.invalidArgument('验证码错误');
      }
    }

    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) {
      throw Biz.notFound('用户不存在');
    }

    await this.sendCodeAndStore(email, EMAIL_CODE_FIND_PASSWORD, ip);
    return {};
  }

  async findPasswordStepTwo(body: FindPasswordBody): Promise<Record<string, never>> {
    const email = String(body.email ?? '').trim();
    const password = body.password ?? '';

    if (!this.isValidEmail(email)) {
      throw Biz.invalidArgument('邮箱格式不正确');
    }
    if (password.length < 6) {
      throw Biz.invalidArgument('密码长度不能小于6位');
    }

    if (this.config.getBool('security', 'enable_captcha_find_password')) {
      if (!body.captcha_id || !body.captcha) {
        throw Biz.invalidArgument('请输入验证码');
      }
      if (!this.captcha.verify(body.captcha_id, body.captcha, true)) {
        throw Biz.invalidArgument('验证码错误');
      }
    }

    if (!body.code) {
      throw Biz.invalidArgument('邮箱验证码错误');
    }

    const code = await this.emailCodeRepo.findOne({
      where: { email, code_type: EMAIL_CODE_FIND_PASSWORD },
      order: { id: 'DESC' as const },
    });
    if (!code || code.code !== body.code || code.is_used) {
      throw Biz.invalidArgument('邮箱验证码错误');
    }
    const expireAt = (code.created_at ? new Date(code.created_at).getTime() : Date.now()) + 30 * 60 * 1000;
    if (expireAt < Date.now()) {
      throw Biz.invalidArgument('邮箱验证码已过期');
    }

    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) {
      throw Biz.notFound('用户不存在');
    }

    await this.userRepo.update(user.id, {
      password: makePassword(password),
      updated_at: new Date(),
    });
    await this.emailCodeRepo.update(code.id, { is_used: true });

    return {};
  }

  async sendEmailCode(body: SendEmailCodeBody, ip = ''): Promise<Record<string, never>> {
    const email = String(body.email ?? '').trim();
    if (!this.isValidEmail(email)) {
      throw Biz.invalidArgument('邮箱格式不正确');
    }

    if (this.config.getBool('security', 'enable_captcha_register')) {
      if (!body.captcha_id || !body.captcha) {
        throw Biz.invalidArgument('请输入验证码');
      }
      if (!this.captcha.verify(body.captcha_id, body.captcha, false)) {
        throw Biz.invalidArgument('验证码错误');
      }
    }

    const existUser = await this.userRepo.findOne({ where: { email } });
    if (existUser) {
      throw Biz.alreadyExists('邮箱已存在');
    }

    await this.sendCodeAndStore(email, Number(body.type) || EMAIL_CODE_REGISTER, ip);
    return {};
  }
}