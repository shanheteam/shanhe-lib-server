import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import { SearchRecord } from '../../entities';
import { Biz } from '../../common/biz.exception';
import {
  normalizePageSize,
  orLike,
  toNumberArray,
  toStringValue,
} from '../../common/query.util';

@Injectable()
export class SearchRecordService {
  constructor(
    @InjectRepository(SearchRecord)
    private readonly repo: Repository<SearchRecord>,
  ) {}

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('搜索记录ID不能为空');
    await this.repo.delete(ids);
  }

  async list(query: any): Promise<{ total: number; search_record: SearchRecord[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const where: any = {};
    const userIds = toNumberArray(query.user_id);
    if (userIds.length) where.user_id = In(userIds);
    const keywords = toStringValue(query.keywords);
    const ip = toStringValue(query.ip);

    let conditions = orLike<SearchRecord>(where, ['keywords'], keywords);
    if (ip) {
      conditions = conditions.map((c) => ({ ...c, ip: Like(`%${ip}%`) }));
    }

    const [rows, total] = await this.repo.findAndCount({
      where: conditions,
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });

    return {
      total,
      search_record: rows.map((r) => ({
        ...r,
        spend_time: Number(r.spend_time ?? 0),
      })),
    };
  }
}