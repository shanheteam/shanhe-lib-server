import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { Advertisement } from '../../entities';
import { Biz } from '../../common/biz.exception';
import {
  defined,
  normalizePageSize,
  orLike,
  toBoolArray,
  toInt,
  toStringValue,
} from '../../common/query.util';

@Injectable()
export class AdvertisementService {
  constructor(
    @InjectRepository(Advertisement)
    private readonly repo: Repository<Advertisement>,
  ) {}

  async create(data: any, userId: number): Promise<Advertisement> {
    if (!data.position || !data.content) {
      throw Biz.invalidArgument('广告位和广告内容均不能为空');
    }
    const entity = this.repo.create({
      user_id: userId,
      position: data.position ?? '',
      title: data.title ?? '',
      content: data.content ?? '',
      remark: data.remark ?? '',
      enable: data.enable === undefined ? true : Boolean(data.enable),
      start_time: data.start_time ?? null,
      end_time: data.end_time ?? null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return this.repo.save(entity);
  }

  async update(data: any): Promise<void> {
    const id = toInt(data.id, 0);
    if (id <= 0) throw Biz.invalidArgument('广告id不能为空');
    const partial = defined(data, ['id']);
    const res = await this.repo.update(id, { ...partial, updated_at: new Date() });
    if (!res.affected) throw Biz.notFound('广告不存在');
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('广告id不能为空');
    await this.repo.delete(ids);
  }

  async get(id: number): Promise<Advertisement> {
    if (id <= 0) throw Biz.invalidArgument('广告id不能为空');
    const ad = await this.repo.findOne({ where: { id } });
    if (!ad) throw Biz.notFound('广告不存在');
    return ad;
  }

  async getByPosition(positions: string[]): Promise<{ total: number; advertisement: Advertisement[] }> {
    const now = new Date();
    const where: any = {
      enable: true,
      start_time: LessThanOrEqual(now),
      end_time: MoreThanOrEqual(now),
    };
    if (positions.length) where.position = In(positions);
    const rows = await this.repo.find({ where, order: { id: 'DESC' } });
    return {
      total: rows.length,
      advertisement: rows.map((r) => ({ ...r, remark: '' })),
    };
  }

  async list(query: any): Promise<{ total: number; advertisement: Advertisement[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const where: any = {};
    const positions = toStringValue(query.position)
      ? [toStringValue(query.position)]
      : [];
    const posArr = Array.isArray(query.position)
      ? (query.position as string[])
      : positions;
    if (posArr.length) where.position = In(posArr);
    const enables = toBoolArray(query.enable);
    if (enables.length) where.enable = In(enables);
    const wd = toStringValue(query.wd);

    const [rows, total] = await this.repo.findAndCount({
      where: orLike<Advertisement>(where, ['title', 'content', 'remark'], wd),
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { total, advertisement: rows };
  }
}