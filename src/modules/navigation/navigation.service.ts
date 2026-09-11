import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Navigation } from '../../entities';
import { Biz } from '../../common/biz.exception';
import {
  defined,
  normalizePageSize,
  orLike,
  toInt,
  toNumberArray,
  toStringValue,
} from '../../common/query.util';

@Injectable()
export class NavigationService {
  constructor(
    @InjectRepository(Navigation)
    private readonly repo: Repository<Navigation>,
  ) {}

  async create(data: any): Promise<Navigation> {
    const entity = this.repo.create({
      title: data.title ?? '',
      href: data.href ?? '',
      target: data.target ?? '',
      color: data.color ?? '',
      description: data.description ?? '',
      parent_id: data.parent_id ?? 0,
      sort: data.sort ?? 0,
      enable: data.enable === undefined ? false : Boolean(data.enable),
      fixed: data.fixed === undefined ? false : Boolean(data.fixed),
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
    if (!res.affected) throw Biz.notFound('导航不存在');
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('导航ID不能为空');
    await this.repo.delete(ids);
  }

  async get(id: number): Promise<Navigation> {
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw Biz.notFound('导航不存在');
    return item;
  }

  async list(query: any): Promise<{ total: number; navigation: Navigation[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const where: any = {};
    const wd = toStringValue(query.wd);

    const [rows, total] = await this.repo.findAndCount({
      where: orLike<Navigation>(where, ['title', 'description', 'href'], wd),
      order: { sort: 'DESC', id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { total, navigation: rows };
  }
}