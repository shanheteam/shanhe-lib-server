import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Banner } from '../../entities';
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

@Injectable()
export class BannerService {
  constructor(
    @InjectRepository(Banner)
    private readonly repo: Repository<Banner>,
  ) {}

  async create(data: any): Promise<Banner> {
    const entity = this.repo.create({
      title: data.title ?? '',
      description: data.description ?? '',
      path: data.path ?? '',
      url: data.url ?? '',
      sort: data.sort ?? 0,
      type: data.type ?? 0,
      enable: data.enable === undefined ? true : Boolean(data.enable),
      created_at: new Date(),
      updated_at: new Date(),
    });
    return this.repo.save(entity);
  }

  async update(data: any): Promise<void> {
    const id = toInt(data.id, 0);
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const partial = defined(data, ['id']);
    const res = await this.repo.update(id, { ...partial, updated_at: new Date() });
    if (!res.affected) throw Biz.notFound('轮播图不存在');
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('轮播图ID不能为空');
    await this.repo.delete(ids);
  }

  async get(id: number): Promise<Banner> {
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const banner = await this.repo.findOne({ where: { id } });
    if (!banner) throw Biz.notFound('轮播图不存在');
    return banner;
  }

  async list(query: any): Promise<{ total: number; banner: Banner[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const where: any = {};
    const types = toNumberArray(query.type);
    if (types.length) where.type = In(types);
    const enables = toBoolArray(query.enable);
    if (enables.length) where.enable = In(enables);
    const wd = toStringValue(query.wd);

    const [rows, total] = await this.repo.findAndCount({
      where: orLike<Banner>(where, ['title', 'description'], wd),
      order: { sort: 'DESC', id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { total, banner: rows };
  }
}