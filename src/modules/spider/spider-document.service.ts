import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SpiderDocument } from '../../entities';
import { Biz } from '../../common/biz.exception';
import {
  normalizePageSize,
  orLike,
  toInt,
  toNumberArray,
  toStringValue,
} from '../../common/query.util';
import { SpiderCrawlerService } from './spider-crawler.service';

/** 嗅探发现的附件文档（spider_document）管理 */
@Injectable()
export class SpiderDocumentService {
  constructor(
    @InjectRepository(SpiderDocument)
    private readonly repo: Repository<SpiderDocument>,
    private readonly crawler: SpiderCrawlerService,
  ) {}

  async list(query: any): Promise<{ total: number; spider_document: SpiderDocument[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const where: any = {};
    const statuses = toNumberArray(query.status);
    if (statuses.length) where.status = In(statuses);
    const userIds = toNumberArray(query.user_id);
    if (userIds.length) where.user_id = In(userIds);
    const exts = Array.isArray(query.ext) ? query.ext : query.ext ? [query.ext] : [];
    if (exts.length) where.ext = In(exts.map(String));
    const wd = toStringValue(query.wd);
    const [rows, total] = await this.repo.findAndCount({
      where: orLike<SpiderDocument>(
        where,
        ['title', 'title_from_href', 'title_from_url', 'url', 'error'],
        wd,
      ),
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { total, spider_document: rows };
  }

  async get(id: number): Promise<SpiderDocument> {
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw Biz.notFound('文档不存在');
    return row;
  }

  private readonly editable = [
    'status',
    'url',
    'language',
    'title',
    'title_from_href',
    'title_from_url',
    'title_from_attachment',
    'price',
    'size',
    'ext',
    'content_type',
    'save_path',
    'user_id',
    'category_id',
    'document_id',
    'error',
  ];

  private pickFields(data: any): Record<string, any> {
    const partial: Record<string, any> = {};
    for (const key of this.editable) {
      if (data[key] !== undefined) partial[key] = data[key];
    }
    return partial;
  }

  async update(data: any): Promise<void> {
    const id = toInt(data.id, 0);
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const res = await this.repo.update(id, {
      ...this.pickFields(data),
      updated_at: new Date(),
    });
    if (!res.affected) throw Biz.notFound('文档不存在');
  }

  /**
   * 批量更新（批量修改字段 / 加入下载队列 status=1 / 加入发布队列 status=5）。
   * 入队后立即触发执行。
   */
  async batch(items: any[]): Promise<void> {
    const list = (items || []).filter((it) => it && Number(it.id) > 0);
    if (!list.length) throw Biz.invalidArgument('请选择数据');
    const downloadIds: number[] = [];
    const publishIds: number[] = [];
    for (const item of list) {
      const id = Number(item.id);
      const partial = this.pickFields(item);
      if ([1, 5].includes(Number(item.status))) partial.error = '';
      await this.repo.update(id, { ...partial, updated_at: new Date() });
      if (Number(item.status) === 1) downloadIds.push(id);
      if (Number(item.status) === 5) publishIds.push(id);
    }
    for (const id of downloadIds) this.crawler.runDocumentDownload(id).catch(() => undefined);
    for (const id of publishIds) this.crawler.runDocumentPublish(id).catch(() => undefined);
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('请选择数据');
    await this.repo.delete(ids);
  }
}
