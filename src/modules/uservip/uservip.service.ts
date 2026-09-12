import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserVip, User } from '../../entities';
import { Biz } from '../../common/biz.exception';
import {
  defined,
  normalizePageSize,
  toInt,
  toNumberArray,
  toStringValue,
} from '../../common/query.util';

/** 用户 VIP 会员列表（后台） */
@Injectable()
export class UserVipService {
  constructor(
    @InjectRepository(UserVip)
    private readonly repo: Repository<UserVip>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async list(query: any): Promise<{ total: number; user_vip: any[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const qb = this.repo
      .createQueryBuilder('v')
      .leftJoin(User, 'u', 'u.id = v.user_id')
      .select(['v.*', 'u.username AS username', 'u.mobile AS mobile', 'u.avatar AS avatar']);

    const userIds = toNumberArray(query.user_id);
    if (userIds.length) qb.andWhere('v.user_id IN (:...userIds)', { userIds });
    const types = toNumberArray(query.type);
    if (types.length) qb.andWhere('v.type IN (:...types)', { types });

    if (String(query.active ?? '') === 'true') {
      qb.andWhere('v.expired_at > NOW()');
    } else if (String(query.active ?? '') === 'false') {
      qb.andWhere('v.expired_at <= NOW()');
    }

    const wd = toStringValue(query.wd);
    if (wd) qb.andWhere('(u.username LIKE :wd OR u.mobile LIKE :wd)', { wd: `%${wd}%` });

    qb.orderBy('v.id', 'DESC').skip((page - 1) * size).take(size);
    const [rows, total] = await Promise.all([qb.getRawMany(), qb.getCount()]);
    return { total, user_vip: rows };
  }

  async update(data: any): Promise<void> {
    const id = toInt(data.id, 0);
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const partial = defined(data, [
      'id',
      'user_id',
      'type',
      'discount',
      'download',
      'download_used',
      'times',
      'joined_at',
      'expired_at',
      'order_no',
    ]);
    if (partial.joined_at !== undefined) {
      partial.joined_at = partial.joined_at ? new Date(partial.joined_at as string) : null;
    }
    if (partial.expired_at !== undefined) {
      partial.expired_at = partial.expired_at ? new Date(partial.expired_at as string) : null;
    }
    const res = await this.repo.update(id, { ...partial, updated_at: new Date() });
    if (!res.affected) throw Biz.notFound('会员记录不存在');
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('请选择数据');
    await this.repo.delete({ id: In(ids) });
  }
}
