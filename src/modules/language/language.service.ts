import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Language } from '../../entities';
import { BaseCrudService } from '../../common/base-crud.service';
import { Biz } from '../../common/biz.exception';
import {
  normalizePageSize,
  orLike,
  toBoolArray,
  toStringValue,
} from '../../common/query.util';

@Injectable()
export class LanguageService extends BaseCrudService<Language> {
  protected readonly label = '语言';

  constructor(
    @InjectRepository(Language)
    repo: Repository<Language>,
  ) {
    super(repo);
  }

  async create(data: any): Promise<void> {
    if (data.code) {
      const exist = await this.repo.findOne({ where: { code: data.code } });
      if (exist) throw Biz.alreadyExists('语言代码已存在');
    }
    const entity = this.repo.create({
      language: data.language ?? '',
      code: data.code ?? '',
      enable: data.enable === undefined ? false : Boolean(data.enable),
      total: data.total ?? 0,
      sort: data.sort ?? 0,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await this.repo.save(entity);
  }

  async updateStatus(ids: number[], enable: boolean): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('语言ID不能为空');
    await this.repo.update(ids, { enable, updated_at: new Date() });
  }

  async list(query: any): Promise<{ total: number; language: Language[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const where: any = {};
    const enables = toBoolArray(query.enable);
    if (enables.length) where.enable = In(enables);
    const wd = toStringValue(query.wd);

    const [rows, total] = await this.repo.findAndCount({
      where: orLike<Language>(where, ['language', 'code'], wd),
      order: { enable: 'DESC', sort: 'DESC', id: 'ASC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { total, language: rows };
  }
}