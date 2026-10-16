import { Repository, In, Not, IsNull, EntityManager } from 'typeorm';
import { Article, ArticleCategory, ArticleRelate, Category, User } from '../../../entities';
import { toNumberArray } from '../../../common/query.util';
import { ARTICLE_LIST_COLUMNS } from '../article.constant';

/**
 * 文章回收站子服务：列出/恢复/彻底删除/清空回收站。
 * 由 ArticleService 组合持有，公开签名不变；列表元数据组装依赖父类 attachListMeta 回调注入。
 */
export class ArticleRecycleService {
  constructor(
    private readonly articleRepo: Repository<Article>,
    private readonly articleCategoryRepo: Repository<ArticleCategory>,
    private readonly articleRelateRepo: Repository<ArticleRelate>,
    private readonly categoryRepo: Repository<Category>,
    private readonly userRepo: Repository<User>,
    private readonly attachListMeta: (rows: Article[]) => Promise<any[]>,
  ) {}

  async listRecycle(
    query: Record<string, any>,
  ): Promise<{ total: number; article: any[] }> {
    const page = Math.max(1, Number(query.page) || 1);
    const size = Number(query.size) || 10;

    const qb = this.articleRepo.createQueryBuilder('a');
    qb.where('a.deleted_at IS NOT NULL');
    if (query.wd) {
      qb.andWhere(
        '(a.title LIKE :wd OR a.keywords LIKE :wd OR a.description LIKE :wd OR a.content LIKE :wd)',
        { wd: `%${query.wd}%` },
      );
    }
    qb.orderBy('a.deleted_at', 'DESC');

    const total = await qb.getCount();
    qb.select(ARTICLE_LIST_COLUMNS.map((c) => `a.${c}`))
      .skip((page - 1) * size)
      .take(size);
    const rows = await qb.getMany();

    return { total, article: await this.attachListMeta(rows) };
  }

  async restore(ids: unknown): Promise<Record<string, never>> {
    const idList = toNumberArray(ids);
    if (!idList.length) return {};

    await this.articleRepo.manager.transaction(async (manager) => {
      await manager.update(Article, { id: In(idList) }, {
        deleted_at: null,
        updated_at: new Date(),
      });

      const acs = await manager.find(ArticleCategory, {
        where: { article_id: In(idList) },
      });
      const countMap = new Map<number, number>();
      for (const ac of acs) {
        countMap.set(ac.category_id, (countMap.get(ac.category_id) || 0) + 1);
      }
      for (const [cid, count] of countMap) {
        await manager.increment(Category, { id: cid }, 'doc_count', count);
      }

      const articles = await manager.find(Article, {
        where: { id: In(idList) },
        select: { id: true, user_id: true },
      });
      for (const a of articles) {
        await manager.increment(User, { id: a.user_id }, 'article_count', 1);
      }
    });

    return {};
  }

  async deleteRecycle(ids: unknown): Promise<Record<string, never>> {
    const idList = toNumberArray(ids);
    if (!idList.length) return {};

    await this.articleRepo.manager.transaction(async (manager) => {
      await this.hardDelete(manager, idList);
    });

    return {};
  }

  async emptyRecycle(): Promise<Record<string, never>> {
    for (;;) {
      const rows = await this.articleRepo.find({
        where: { deleted_at: Not(IsNull()) },
        select: { id: true },
        take: 100,
      });
      const ids = rows.map((r) => r.id);
      if (!ids.length) break;

      await this.articleRepo.manager.transaction(async (manager) => {
        await this.hardDelete(manager, ids);
      });
    }
    return {};
  }

  /** 物理删除一篇文章及其分类/相关多对多关联（业务硬删除，调用方负责开启事务） */
  private async hardDelete(manager: EntityManager, ids: number[]): Promise<void> {
    await manager.delete(Article, { id: In(ids) });
    await manager.delete(ArticleCategory, { article_id: In(ids) });
    await manager.delete(ArticleRelate, { article_id: In(ids) });
  }
}