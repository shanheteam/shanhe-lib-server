import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Friendlink } from '../../entities';
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
export class FriendlinkService {
  constructor(
    @InjectRepository(Friendlink)
    private readonly repo: Repository<Friendlink>,
  ) {}

  async create(data: any): Promise<Friendlink> {
    const entity = this.repo.create({
      title: data.title ?? '',
      link: data.link ?? '',
      description: data.description ?? '',
      sort: data.sort ?? 0,
      enable: data.enable === undefined ? false : Boolean(data.enable),
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
    if (!res.affected) throw Biz.notFound('友情链接不存在');
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('友情链接ID不能为空');
    await this.repo.delete(ids);
  }

  async get(id: number): Promise<Friendlink> {
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw Biz.notFound('友情链接不存在');
    return item;
  }

  async list(query: any): Promise<{ total: number; friendlink: Friendlink[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const where: any = {};
    const enables = toBoolArray(query.enable);
    if (enables.length) where.enable = In(enables);
    const wd = toStringValue(query.wd);

    const [rows, total] = await this.repo.findAndCount({
      where: orLike<Friendlink>(where, ['title', 'description'], wd),
      order: { enable: 'DESC', sort: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { total, friendlink: rows };
  }
}