import { Injectable } from '@nestjs/common';
import { ObjectLiteral, Repository } from 'typeorm';
import { Biz } from './biz.exception';
import { defined, toInt } from './query.util';

/**
 * 基础 CRUD 服务：为"单表、数值主键、含 updated_at"的模块提供统一的
 * update / remove / get 实现，消除各模块间重复的入参校验与不存在判断。
 * create / list 因各模块字段映射与过滤/排序/返回结构不同，由子类自行实现。
 */
@Injectable()
export abstract class BaseCrudService<E extends ObjectLiteral> {
  /** 用于生成报错文案的模块名，如 '轮播图'、'广告' */
  protected abstract readonly label: string;

  constructor(protected readonly repo: Repository<E>) {}

  async update(data: any): Promise<void> {
    const id = toInt(data.id, 0);
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const res = await this.repo.update(id, { ...defined(data, ['id']), updated_at: new Date() } as any);
    if (!res.affected) throw Biz.notFound(`${this.label}不存在`);
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument(`${this.label}ID不能为空`);
    await this.repo.delete(ids);
  }

  async get(id: number): Promise<E> {
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const item = await this.repo.findOne({ where: { id } } as any);
    if (!item) throw Biz.notFound(`${this.label}不存在`);
    return item;
  }
}