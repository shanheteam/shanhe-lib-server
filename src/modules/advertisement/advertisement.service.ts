import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { Advertisement } from '../../entities';
import { BaseCrudService } from '../../common/base-crud.service';
import { Biz } from '../../common/biz.exception';
import {
  normalizePageSize,
  orLike,
  toBoolArray,
  toStringValue,
} from '../../common/query.util';

@Injectable()
export class AdvertisementService extends BaseCrudService<Advertisement> {
  protected readonly label = '广告';

  constructor(
    @InjectRepository(Advertisement)
    repo: Repository<Advertisement>,
  ) {
    super(repo);
  }

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