import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Download } from '../../entities';
import { normalizePageSize } from '../../common/query.util';

@Injectable()
export class DownloadService {
  constructor(
    @InjectRepository(Download)
    private readonly repo: Repository<Download>,
  ) {}

  async list(
    userId: number,
    query: any,
  ): Promise<{ total: number; download: Download[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const [rows, total] = await this.repo.findAndCount({
      where: { user_id: userId },
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { total, download: rows };
  }
}