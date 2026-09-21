import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Navigation } from '../../entities';
import { BaseCrudService } from '../../common/base-crud.service';
import {
  normalizePageSize,
  orLike,
  toStringValue,
} from '../../common/query.util';

@Injectable()
export class NavigationService extends BaseCrudService<Navigation> {
  protected readonly label = '导航';

  constructor(
    @InjectRepository(Navigation)
    repo: Repository<Navigation>,
  ) {
    super(repo);
  }

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