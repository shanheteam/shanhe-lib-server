import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Punishment, User } from '../../entities';
import { Biz } from '../../common/biz.exception';
import {
  defined,
  normalizePageSize,
  orLike,
  toBoolArray,
  toInt,
  toNumberArray,
  toStringValue,
} from '../../common/query.util';

function makeOperators(userId: number, type: number, existing = ''): string {
  let list: { user_id: number; type: number; timestamp: number }[] = [];
  if (existing) {
    try {
      list = JSON.parse(existing);
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
  }
  list.push({ user_id: userId, type, timestamp: Math.floor(Date.now() / 1000) });
  return JSON.stringify(list);
}

@Injectable()
export class PunishmentService {
  constructor(
    @InjectRepository(Punishment)
    private readonly repo: Repository<Punishment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async create(data: any, operatorId: number): Promise<void> {
    const userIds = toNumberArray(data.user_id);
    const types = toNumberArray(data.type);
    if (!userIds.length) throw Biz.invalidArgument('请选择用户');
    if (!types.length) throw Biz.invalidArgument('请选择处罚类型');

    const batch = [];
    for (const userId of userIds) {
      if (userId === 1) continue;
      for (const type of types) {
        batch.push({
          user_id: userId,
          type,
          enable: data.enable === undefined ? true : Boolean(data.enable),
          reason: data.reason ?? '',
          remark: data.remark ?? '',
          end_time: data.end_time ?? null,
          operators: makeOperators(operatorId, type),
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    }
    if (batch.length) await this.repo.save(batch);
  }

  async update(data: any, operatorId: number): Promise<void> {
    const id = toInt(data.id, 0);
    if (id <= 0) throw Biz.invalidArgument('参数不正确');

    const exist = await this.repo.findOne({ where: { id } });
    if (!exist) throw Biz.notFound('处罚记录不存在');

    const partial = defined(data, ['id']);
    if (data.type !== undefined) {
      partial.operators = makeOperators(operatorId, toInt(data.type, 0), exist.operators);
    }
    const res = await this.repo.update(id, { ...partial, updated_at: new Date() });
    if (!res.affected) throw Biz.notFound('处罚记录不存在');
  }

  async get(id: number): Promise<Punishment> {
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw Biz.notFound('处罚记录不存在');
    return item;
  }

  async list(query: any): Promise<{ total: number; punishment: Punishment[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const where: any = {};
    const userIds = toNumberArray(query.user_id);
    if (userIds.length) where.user_id = In(userIds);
    const types = toNumberArray(query.type);
    if (types.length) where.type = In(types);
    const enables = toBoolArray(query.enable);
    if (enables.length) where.enable = In(enables);
    const wd = toStringValue(query.wd);

    const [rows, total] = await this.repo.findAndCount({
      where: orLike<Punishment>(where, ['reason', 'remark'], wd),
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });

    const displayUserIds = [...new Set(rows.map((r) => Number(r.user_id)).filter((id) => id > 0))];
    const userMap = new Map<number, User>();
    if (displayUserIds.length) {
      const users = await this.userRepo.find({ where: { id: displayUserIds as any } });
      for (const u of users) userMap.set(Number(u.id), u);
    }

    const punishment = rows.map((r) => ({
      ...r,
      id: Number(r.id),
      user_id: Number(r.user_id),
      realname: userMap.get(Number(r.user_id))?.realname ?? '',
    }));

    return { total, punishment };
  }

  async cancel(ids: number[], operatorId: number): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('处罚ID不能为空');
    const rows = await this.repo.find({ where: { id: In(ids) } });
    for (const item of rows) {
      item.enable = false;
      item.operators = makeOperators(operatorId, 0, item.operators);
      item.updated_at = new Date();
    }
    if (rows.length) await this.repo.save(rows);
  }
}