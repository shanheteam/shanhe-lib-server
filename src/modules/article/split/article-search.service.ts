import { Repository, In, IsNull } from 'typeorm';
import { Article, ArticleCategory, ArticleRelate, Category, User } from '../../../entities';
import { toNumberArray } from '../../../common/query.util';
import { tb } from '../../../database/naming-strategy';
import { Biz } from '../../../common/biz.exception';
import {
  ARTICLE_LIST_COLUMNS,
  ALLOWED_ARTICLE_SORT,
  ArticleStatus,
} from '../article.constant';

/**
 * 文章搜索/相关子服务：关键词搜索、相关文章推荐。
 * 由 ArticleService 组合持有，公开签名不变；列表元数据组装与时间范围过滤依赖回调注入。
 */
export class ArticleSearchService {
  constructor(
    private readonly articleRepo: Repository<Article>,
    private readonly articleRelateRepo: Repository<ArticleRelate>,
    private readonly articleCategoryRepo: Repository<ArticleCategory>,
    private readonly categoryRepo: Repository<Category>,
    private readonly userRepo: Repository<User>,
    private readonly attachListMeta: (rows: Article[]) => Promise<any[]>,
    private readonly applyCreatedAtRange: (qb: any, value: unknown) => void,
  ) {}

  async search(
    query: Record<string, any>,
  ): Promise<{ total: number; spend: string; article: any[] }> {
    const start = Date.now();
    const wd = String(query.wd || '').trim();
    if (!wd) return { total: 0, spend: '0.000', article: [] };

    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.max(1, Math.min(10, Number(query.size) || 10));

    const qb = this.articleRepo.createQueryBuilder('a');
    qb.where('a.deleted_at IS NULL AND a.status = :pass', {
      pass: ArticleStatus.Pass,
    });

    const words = wd.split(/\s+/).filter(Boolean);
    words.forEach((word, i) => {
      const key = `wd${i}`;
      qb.andWhere(
        `(a.title LIKE :${key} OR a.keywords LIKE :${key} OR a.description LIKE :${key})`,
        { [key]: `%${word}%` },
      );
    });

    const categoryIds = toNumberArray(query.category_id);
    if (categoryIds.length) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM ${tb('article_category')} ac WHERE ac.article_id = a.id AND ac.category_id IN (:...categoryIds))`,
        { categoryIds },
      );
    }

    const userIds = toNumberArray(query.user_id);
    if (userIds.length) qb.andWhere('a.user_id IN (:...userIds)', { userIds });

    this.applyCreatedAtRange(qb, query.created_at);

    const sortField =
      query.sort === 'latest'
        ? 'id'
        : typeof query.sort === 'string' && ALLOWED_ARTICLE_SORT.has(query.sort)
          ? query.sort
          : 'id';
    qb.orderBy(`a.${sortField}`, 'DESC');

    const total = await qb.getCount();
    qb.select(ARTICLE_LIST_COLUMNS.map((c) => `a.${c}`))
      .skip((page - 1) * size)
      .take(size);
    const rows = await qb.getMany();

    return {
      total,
      spend: ((Date.now() - start) / 1000).toFixed(3),
      article: await this.attachListMeta(rows),
    };
  }

  async getRelated(query: Record<string, any>): Promise<{ article: any[] }> {
    const identifier = String(query.identifier || '');
    if (!identifier) throw Biz.invalidArgument('参数错误:文章标识为空');

    const target = await this.articleRepo.findOne({
      where: { identifier },
      select: { id: true },
    });
    if (!target) throw Biz.notFound('相关文章不存在');

    const relate = await this.articleRelateRepo.findOne({
      where: { article_id: target.id },
    });

    let ids: number[] = [];
    if (relate && relate.related_article_id) {
      try {
        const parsed = JSON.parse(relate.related_article_id);
        if (Array.isArray(parsed)) {
          ids = parsed.map((v) => Number(v)).filter((n) => n > 0);
        }
      } catch {
        ids = [];
      }
    }

    let rows: Article[] = [];
    if (ids.length) {
      rows = await this.articleRepo.find({
        where: { id: In(ids), status: ArticleStatus.Pass, deleted_at: IsNull() },
        take: 11,
      });
    }

    if (!rows.length) return { article: [] };

    return { article: await this.attachListMeta(rows) };
  }
}