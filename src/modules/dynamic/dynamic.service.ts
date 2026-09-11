import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dynamic } from '../../entities';
import { normalizePageSize } from '../../common/query.util';

@Injectable()
export class DynamicService {
  constructor(
    @InjectRepository(Dynamic)
    private readonly repo: Repository<Dynamic>,
  ) {}

  async list(
    userId: number,
    query: any,
  ): Promise<{ total: number; dynamic: Dynamic[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const [rows, total] = await this.repo.findAndCount({
      where: { user_id: userId },
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { total, dynamic: rows };
  }
}