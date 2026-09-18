import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { Sms, User } from '../../entities';
import { ConfigService } from '../../config/config.service';
import { Biz } from '../../common/biz.exception';
import { tb } from '../../database/naming-strategy';
import {
  normalizePageSize,
  toNumberArray,
  toStringValue,
} from '../../common/query.util';
import { sendSmsByProvider } from './sms.providers';

const MOBILE_RE = /^1\d{10}$/;

@Injectable()
export class SmsService {
  constructor(
    @InjectRepository(Sms)
    private readonly repo: Repository<Sms>,
    private readonly config: ConfigService,
  ) {}

  async list(query: any): Promise<{ total: number; sms: any[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const qb = this.repo
      .createQueryBuilder('s')
      .leftJoin(User, 'u', 'u.id = s.user_id')
      .select(['s.*', 'u.realname AS realname'])
      .orderBy('s.id', 'DESC')
      .skip((page - 1) * size)
      .take(size);

    const types = toNumberArray(query.type);
    if (types.length) qb.andWhere('s.type IN (:...types)', { types });
    const statuses = toNumberArray(query.status);
    if (statuses.length) qb.andWhere('s.status IN (:...statuses)', { statuses });
    const userIds = toNumberArray(query.user_id);
    if (userIds.length) qb.andWhere('s.user_id IN (:...userIds)', { userIds });
    const mobile = toStringValue(query.mobile || query.wd);
    if (mobile) qb.andWhere('s.mobile LIKE :mobile', { mobile: `%${mobile}%` });
    const provider = toStringValue(query.provider);
    if (provider) qb.andWhere('s.provider = :provider', { provider });
    if (query.start_at) qb.andWhere('s.created_at >= :start', { start: String(query.start_at) });
    if (query.end_at) qb.andWhere('s.created_at <= :end', { end: String(query.end_at) });

    const [rows, total] = await Promise.all([qb.getRawMany(), qb.getCount()]);
    return { total, sms: rows };
  }

  async get(id: number): Promise<Sms> {
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw Biz.notFound('短信记录不存在');
    return row;
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('请选择数据');
    await this.repo.delete(ids);
  }

  /**
   * 发送短信验证码（注册/登录/找回密码）。
   * 同一手机号 60 秒内仅允许发送一次。
   */
  async send(input: { mobile: string; type: number; userId?: number; ip?: string }): Promise<void> {
    const mobile = String(input.mobile ?? '').trim();
    const type = Number(input.type);
    if (!MOBILE_RE.test(mobile)) throw Biz.invalidArgument('手机号格式不正确');
    if (![0, 1, 2].includes(type)) throw Biz.invalidArgument('短信类型不正确');
    if (!this.config.getBool('system', 'enable_sms', false)) {
      throw Biz.invalidArgument('短信服务未开启');
    }

    const provider = this.config.get('sms', 'sms_provider', 'smsAliyun');
    if (!this.config.getBool(provider, 'enable', false)) {
      throw Biz.invalidArgument('短信服务商未启用，请在后台短信配置中开启');
    }

    const recent = await this.repo.findOne({
      where: { mobile, created_at: MoreThan(new Date(Date.now() - 60_000)) },
      order: { id: 'DESC' },
    });
    if (recent) throw Biz.invalidArgument('发送过于频繁，请 60 秒后再试');

    const conf: Record<string, string> = {};
    const rows = await this.repo.manager.query(
      `SELECT name, value FROM ${tb('config')} WHERE category = ? AND deleted_at IS NULL`,
      [provider],
    );
    for (const row of rows as Array<{ name: string; value: string }>) {
      conf[row.name] = row.value ?? '';
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const now = new Date();
    const record = await this.repo.save(this.repo.create({
      type,
      status: 0,
      user_id: Number(input.userId) || 0,
      mobile,
      code,
      ip: String(input.ip ?? '').slice(0, 45),
      provider,
      error: '',
      response: '',
      created_at: now,
      updated_at: now,
    }));

    const result = await sendSmsByProvider(provider, { mobile, code, type, conf });
    await this.repo.update(record.id, {
      status: result.ok ? 1 : 2,
      response: result.response,
      error: result.error,
      updated_at: new Date(),
    });
    if (!result.ok) throw Biz.internal(result.error || '短信发送失败');
  }
}
