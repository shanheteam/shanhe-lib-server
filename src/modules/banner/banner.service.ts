import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Banner } from '../../entities';
import { BaseCrudService } from '../../common/base-crud.service';
import {
  normalizePageSize,
  orLike,
  toBoolArray,
  toNumberArray,
  toStringValue,
} from '../../common/query.util';

@Injectable()
export class BannerService extends BaseCrudService<Banner> {
  protected readonly label = '轮播图';

  constructor(
    @InjectRepository(Banner)
    repo: Repository<Banner>,
  ) {
    super(repo);
  }

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