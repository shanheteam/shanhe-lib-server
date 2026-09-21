import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Friendlink } from '../../entities';
import { BaseCrudService } from '../../common/base-crud.service';
import {
  normalizePageSize,
  orLike,
  toBoolArray,
  toStringValue,
} from '../../common/query.util';

@Injectable()
export class FriendlinkService extends BaseCrudService<Friendlink> {
  protected readonly label = '友情链接';

  constructor(
    @InjectRepository(Friendlink)
    repo: Repository<Friendlink>,
  ) {
    super(repo);
  }

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