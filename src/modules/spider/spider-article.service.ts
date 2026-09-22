import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SpiderArticleList, SpiderArticleDetail } from '../../entities';
import { Biz } from '../../common/biz.exception';
import {
  normalizePageSize,
  orLike,
  toInt,
  toNumberArray,
  toStringValue,
} from '../../common/query.util';
import { SpiderCrawlerService } from './spider-crawler.service';

/** 文章嗅探来源（spider_article_list）与文章详情（spider_article_detail）管理 */
@Injectable()
export class SpiderArticleService {
  constructor(
    @InjectRepository(SpiderArticleList)
    private readonly sourceRepo: Repository<SpiderArticleList>,
    @InjectRepository(SpiderArticleDetail)
    private readonly detailRepo: Repository<SpiderArticleDetail>,
    private readonly crawler: SpiderCrawlerService,
  ) {}

  // ---------- 列表页来源 ----------

  async createSource(data: any): Promise<{ created: number }> {
    // 专业版新增时支持多行链接（url 为数组），共享同一套采集规则
    const rawUrls: string[] = Array.isArray(data.url)
      ? data.url
      : String(data.url ?? '').split('\n');
    const urls = Array.from(
      new Set(rawUrls.map((u) => String(u ?? '').trim()).filter(Boolean)),
    );
    if (!urls.length) throw Biz.invalidArgument('列表页链接不能为空');

    const exist = await this.sourceRepo.find({ select: { url: true } });
    const existSet = new Set(exist.map((x) => x.url));
    const now = new Date();
    const entities = urls
      .filter((url) => !existSet.has(url))
      .map((url) =>
        this.sourceRepo.create({
          url,
          status: 0,
          total: 0,
          enable_browser: !!data.enable_browser,
          frequency: Number(data.frequency) || 0,
          list_rules: String(data.list_rules ?? ''),
          content_title_rules: String(data.content_title_rules ?? ''),
          content_rules: String(data.content_rules ?? ''),
          content_exclude_rules: String(data.content_exclude_rules ?? ''),
          content_replace_rules: String(data.content_replace_rules ?? ''),
          error: '',
          created_at: now,
          updated_at: now,
        }),
      );
    if (entities.length) await this.sourceRepo.save(entities);
    return { created: entities.length };
  }

  async getSource(id: number): Promise<SpiderArticleList> {
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const row = await this.sourceRepo.findOne({ where: { id } });
    if (!row) throw Biz.notFound('文章列表页不存在');
    return row;
  }

  async updateSource(data: any): Promise<void> {
    const id = toInt(data.id, 0);
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const partial: Record<string, any> = {};
    const fields = [
      'status',
      'total',
      'error',
      'enable_browser',
      'frequency',
      'list_rules',
      'content_title_rules',
      'content_rules',
      'content_exclude_rules',
      'content_replace_rules',
    ];
    for (const key of fields) {
      if (data[key] !== undefined) partial[key] = data[key];
    }
    if (data.url !== undefined && String(data.url).trim()) {
      partial.url = String(data.url).trim();
    }
    const res = await this.sourceRepo.update(id, { ...partial, updated_at: new Date() });
    if (!res.affected) throw Biz.notFound('文章来源不存在');
  }

  async removeSource(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('请选择数据');
    await this.sourceRepo.delete(ids);
    // 同时清理该来源嗅探到、但尚未发布的文章
    await this.detailRepo.delete({ article_list_id: In(ids), article_id: 0 });
  }

  async listSource(query: any): Promise<{ total: number; spider_article_list: SpiderArticleList[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const where: any = {};
    const statuses = toNumberArray(query.status);
    if (statuses.length) where.status = In(statuses);
    const wd = toStringValue(query.wd);
    const [rows, total] = await this.sourceRepo.findAndCount({
      where: orLike<SpiderArticleList>(where, ['url', 'error'], wd),
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { total, spider_article_list: rows };
  }

  async setSourceStatus(ids: number[], status: number): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('请选择数据');
    await this.sourceRepo.update({ id: In(ids) }, { status, error: '', updated_at: new Date() });
    if (status === 1) {
      for (const id of ids) this.crawler.runSource(id).catch(() => undefined);
    }
  }

  // ---------- 文章详情 ----------

  async listDetail(query: any): Promise<{ total: number; spider_article_detail: SpiderArticleDetail[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const where: any = {};
    const listIds = toNumberArray(query.article_list_id);
    if (listIds.length) where.article_list_id = In(listIds);
    const statuses = toNumberArray(query.status);
    if (statuses.length) where.status = In(statuses);
    const userIds = toNumberArray(query.user_id);
    if (userIds.length) where.user_id = In(userIds);
    const wd = toStringValue(query.wd);
    const [rows, total] = await this.detailRepo.findAndCount({
      where: orLike<SpiderArticleDetail>(where, ['title', 'url', 'error'], wd),
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { total, spider_article_detail: rows };
  }

  async getDetail(id: number): Promise<SpiderArticleDetail> {
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const row = await this.detailRepo.findOne({ where: { id } });
    if (!row) throw Biz.notFound('文章不存在');
    return row;
  }

  private readonly detailEditable = [
    'article_list_id',
    'status',
    'title',
    'url',
    'source',
    'description',
    'keywords',
    'content',
    'content_title_rules',
    'content_rules',
    'content_exclude_rules',
    'content_replace_rules',
    'enable_browser',
    'published_at',
    'article_id',
    'user_id',
    'category_id',
    'error',
  ];

  private pickDetailFields(data: any): Record<string, any> {
    const partial: Record<string, any> = {};
    for (const key of this.detailEditable) {
      if (data[key] !== undefined) partial[key] = data[key];
    }
    if (partial.published_at !== undefined) {
      partial.published_at = partial.published_at ? new Date(partial.published_at) : null;
    }
    return partial;
  }

  async updateDetail(data: any): Promise<void> {
    const id = toInt(data.id, 0);
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const partial = this.pickDetailFields(data);
    const res = await this.detailRepo.update(id, { ...partial, updated_at: new Date() });
    if (!res.affected) throw Biz.notFound('文章不存在');
  }

  /**
   * 批量更新文章详情（加入采集队列 / 加入发布队列 / 批量保存编辑内容）。
   * 每条记录的 status 决定动作：1=立即采集；5=立即发布。
   */
  async batchDetail(items: any[]): Promise<void> {
    const list = (items || []).filter((it) => it && Number(it.id) > 0);
    if (!list.length) throw Biz.invalidArgument('请选择数据');
    const crawlIds: number[] = [];
    const publishIds: number[] = [];
    for (const item of list) {
      const id = Number(item.id);
      const partial = this.pickDetailFields(item);
      // 入队时清空错误信息，便于重新执行
      if ([1, 5].includes(Number(item.status))) partial.error = '';
      await this.detailRepo.update(id, { ...partial, updated_at: new Date() });
      if (Number(item.status) === 1) crawlIds.push(id);
      if (Number(item.status) === 5) publishIds.push(id);
    }
    for (const id of crawlIds) this.crawler.runDetailCrawl(id).catch(() => undefined);
    for (const id of publishIds) this.crawler.runDetailPublish(id).catch(() => undefined);
  }

  async removeDetail(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('请选择数据');
    await this.detailRepo.delete(ids);
  }
}
