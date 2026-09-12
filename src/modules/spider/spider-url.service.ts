import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SpiderUrl } from '../../entities';
import { Biz } from '../../common/biz.exception';
import {
  defined,
  normalizePageSize,
  orLike,
  toInt,
  toNumberArray,
  toStringValue,
} from '../../common/query.util';
import { SpiderCrawlerService } from './spider-crawler.service';

@Injectable()
export class SpiderUrlService {
  constructor(
    @InjectRepository(SpiderUrl)
    private readonly repo: Repository<SpiderUrl>,
    private readonly crawler: SpiderCrawlerService,
  ) {}

  async create(data: any): Promise<{ created: number }> {
    // 专业版新增时支持多行链接（url 为数组），编辑时为单个字符串
    const rawUrls: string[] = Array.isArray(data.url)
      ? data.url
      : String(data.url ?? '').split('\n');
    const urls = Array.from(
      new Set(
        rawUrls
          .map((u) => String(u ?? '').trim())
          .filter(Boolean),
      ),
    );
    if (!urls.length) throw Biz.invalidArgument('采集链接不能为空');

    const exist = await this.repo.find({ select: ['url'] });
    const existSet = new Set(exist.map((x) => x.url));
    const now = new Date();
    const entities = urls
      .filter((url) => !existSet.has(url))
      .map((url) =>
        this.repo.create({
          url,
          status: 0,
          total: 0,
          enable_browser: !!data.enable_browser,
          frequency: Number(data.frequency) || 0,
          level: Number(data.level) || 0,
          url_prefix: String(data.url_prefix ?? ''),
          include_url_keywords: String(data.include_url_keywords ?? ''),
          exclude_url_keywords: String(data.exclude_url_keywords ?? ''),
          error: '',
          created_at: now,
          updated_at: now,
        }),
      );
    if (entities.length) await this.repo.save(entities);
    return { created: entities.length };
  }

  async get(id: number): Promise<SpiderUrl> {
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw Biz.notFound('采集链接不存在');
    return row;
  }

  async update(data: any): Promise<void> {
    const id = toInt(data.id, 0);
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const partial = defined(data, [
      'id',
      'status',
      'total',
      'error',
      'enable_browser',
      'frequency',
      'level',
      'url_prefix',
      'include_url_keywords',
      'exclude_url_keywords',
    ]);
    const res = await this.repo.update(id, { ...partial, updated_at: new Date() });
    if (!res.affected) throw Biz.notFound('采集链接不存在');
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('ID不能为空');
    await this.repo.delete(ids);
  }

  async list(query: any): Promise<{ total: number; spider_url: SpiderUrl[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const where: any = {};
    const statuses = toNumberArray(query.status);
    if (statuses.length) where.status = In(statuses);
    const wd = toStringValue(query.wd);
    const [rows, total] = await this.repo.findAndCount({
      where: orLike<SpiderUrl>(where, ['url', 'error'], wd),
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { total, spider_url: rows };
  }

  /** 批量修改状态；status=1 时入队并立即触发嗅探 */
  async setStatus(ids: number[], status: number): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('请选择数据');
    await this.repo.update({ id: In(ids) }, { status, error: '', updated_at: new Date() });
    if (status === 1) {
      for (const id of ids) {
        // 后台异步执行，不阻塞请求
        this.crawler.runUrl(id).catch(() => undefined);
      }
    }
  }
}
