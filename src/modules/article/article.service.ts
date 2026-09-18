import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { v1 as uuidv1 } from 'uuid';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  Article,
  ArticleCategory,
  ArticleRelate,
  Category,
  Group,
  User,
  UserGroup,
} from '../../entities';
import { Biz } from '../../common/biz.exception';
import { PermissionService } from '../../auth/permission.service';
import { JwtUser } from '../../auth/jwt-user.type';
import { tb } from '../../database/naming-strategy';
import { toNumberArray, toBoolArray, uniqueNumberArray } from '../../common/query.util';

const ARTICLE_STATUS_PENDING = 0;
const ARTICLE_STATUS_PASS = 1;
const ARTICLE_STATUS_REJECT = 2;

const ARTICLE_LIST_COLUMNS = [
  'id',
  'identifier',
  'user_id',
  'view_count',
  'favorite_count',
  'comment_count',
  'title',
  'keywords',
  'description',
  'created_at',
  'updated_at',
  'deleted_at',
  'recommend_at',
  'status',
  'reject_reason',
  'source',
  'source_url',
  'is_notice',
];

const ALLOWED_SORT = new Set([
  'id',
  'view_count',
  'favorite_count',
  'comment_count',
  'created_at',
  'updated_at',
  'recommend_at',
]);

function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function substr(text: string, len: number): string {
  const t = String(text || '');
  return t.length > len ? t.slice(0, len) : t;
}

function genArticleIdentifier(): string {
  const hash = createHash('md5')
    .update(uuidv1() + randomBytes(6).toString('hex'))
    .digest('hex');
  return hash.slice(8, 24);
}

@Injectable()
export class ArticleService {
  constructor(
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
    @InjectRepository(ArticleCategory)
    private readonly articleCategoryRepo: Repository<ArticleCategory>,
    @InjectRepository(ArticleRelate)
    private readonly articleRelateRepo: Repository<ArticleRelate>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    private readonly permissionService: PermissionService,
  ) {}

  // ---------- 创建 / 更新 / 删除 ----------

  async create(input: Record<string, any>, user: JwtUser): Promise<any> {
    const userId = user.userId;
    const isAdmin = await this.permissionService.isAdmin(userId);
    if (!isAdmin && !(await this.canPublishArticle(userId))) {
      throw Biz.permissionDenied('您没有权限发布文章');
    }

    const categoryIds = uniqueNumberArray(toNumberArray(input.category_id));

    let identifier = typeof input.identifier === 'string' ? input.identifier : '';
    if (!isAdmin) identifier = '';
    if (!identifier) identifier = genArticleIdentifier();

    const exist = await this.articleRepo.findOne({
      where: { identifier },
      select: ['id'],
    });
    if (exist && exist.id > 0) throw Biz.alreadyExists('文章标识符已存在');

    const status = isAdmin
      ? ARTICLE_STATUS_PASS
      : await this.getDefaultArticleStatus(userId);

    const now = new Date();
    let recommendAt: Date | null = null;
    if (isAdmin && input.is_recommend) {
      recommendAt = input.recommend_at ? new Date(input.recommend_at) : now;
    }

    const article = this.articleRepo.create({
      identifier,
      user_id: userId,
      view_count: 0,
      favorite_count: 0,
      comment_count: 0,
      title: input.title ?? '',
      keywords: input.keywords ?? '',
      description: input.description ?? '',
      content: input.content ?? '',
      source: input.source ?? '',
      source_url: input.source_url ?? '',
      recommend_at: recommendAt,
      status,
      is_notice: isAdmin && input.is_notice ? 1 : 0,
      reject_reason: '',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
    this.fixKeywordsAndDescription(article);

    await this.articleRepo.manager.transaction(async (manager) => {
      await manager.save(article);
      if (categoryIds.length) {
        await manager.increment(Category, { id: In(categoryIds) }, 'doc_count', 1);
        const rows = categoryIds.map((cid) =>
          manager.create(ArticleCategory, {
            article_id: article.id,
            category_id: cid,
            created_at: now,
            updated_at: now,
          }),
        );
        await manager.save(rows);
      }
      await manager.increment(User, { id: userId }, 'article_count', 1);
    });

    return this.articleToReply(article, categoryIds);
  }

  async update(
    input: Record<string, any>,
    user: JwtUser,
  ): Promise<Record<string, never>> {
    const id = toNumberArray(input.id)[0] || 0;
    if (id <= 0) throw Biz.invalidArgument('缺少文章ID');

    const exist = await this.articleRepo.findOne({ where: { id } });
    if (!exist) throw Biz.notFound('文章不存在');

    const isAdmin = await this.permissionService.isAdmin(user.userId);
    if (!isAdmin && exist.user_id !== user.userId) {
      throw Biz.permissionDenied('您没有权限修改此文章');
    }

    const categoryIds = uniqueNumberArray(toNumberArray(input.category_id));

    let status = exist.status;
    if (exist.status === ARTICLE_STATUS_REJECT) status = ARTICLE_STATUS_PENDING;

    let recommendAt = exist.recommend_at;
    if (isAdmin && input.is_recommend && !exist.recommend_at) {
      recommendAt = new Date();
    }

    const title = input.title ?? exist.title;
    const content = input.content ?? exist.content;
    let keywords = input.keywords ?? '';
    let description = input.description ?? '';
    if (!String(description).trim()) {
      description = substr(stripHtml(content), 200);
    }
    if (!String(keywords).trim()) {
      keywords = (title || '').trim();
    }

    const now = new Date();
    await this.articleRepo.manager.transaction(async (manager) => {
      const old = await manager.find(ArticleCategory, { where: { article_id: id } });
      const oldIds = old.map((o) => o.category_id).filter((cid) => cid > 0);
      if (oldIds.length) {
        await manager.increment(Category, { id: In(oldIds) }, 'doc_count', -1);
      }
      await manager.delete(ArticleCategory, { article_id: id });

      if (categoryIds.length) {
        await manager.increment(Category, { id: In(categoryIds) }, 'doc_count', 1);
        const rows = categoryIds.map((cid) =>
          manager.create(ArticleCategory, {
            article_id: id,
            category_id: cid,
            created_at: now,
            updated_at: now,
          }),
        );
        await manager.save(rows);
      }

      await manager.update(Article, { id }, {
        title,
        keywords,
        description,
        content,
        source: input.source ?? exist.source,
        source_url: input.source_url ?? exist.source_url,
        status,
        is_notice: isAdmin ? (input.is_notice ? 1 : 0) : exist.is_notice,
        recommend_at: recommendAt,
        updated_at: now,
      });
    });

    return {};
  }

  async remove(
    ids: unknown,
    user: JwtUser,
  ): Promise<Record<string, never>> {
    let idList = toNumberArray(ids);
    if (!idList.length) return {};

    const isAdmin = await this.permissionService.isAdmin(user.userId);
    if (!isAdmin) {
      const own = await this.articleRepo.find({
        where: { id: In(idList), user_id: user.userId },
        select: ['id'],
      });
      if (!own.length) throw Biz.permissionDenied('您没有权限删除指定文章');
      idList = own.map((o) => o.id);
    }

    const now = new Date();
    await this.articleRepo.manager.transaction(async (manager) => {
      await manager.update(Article, { id: In(idList) }, {
        deleted_at: now,
        updated_at: now,
      });

      const acs = await manager.find(ArticleCategory, {
        where: { article_id: In(idList) },
      });
      const countMap = new Map<number, number>();
      for (const ac of acs) {
        countMap.set(ac.category_id, (countMap.get(ac.category_id) || 0) + 1);
      }
      for (const [cid, count] of countMap) {
        await manager.increment(Category, { id: cid }, 'doc_count', -count);
      }

      const articles = await manager.find(Article, {
        where: { id: In(idList) },
        select: ['id', 'user_id'],
      });
      for (const a of articles) {
        await manager.increment(User, { id: a.user_id }, 'article_count', -1);
      }
    });

    return {};
  }

  // ---------- 详情 / 列表 ----------

  async get(query: Record<string, any>, user?: JwtUser): Promise<any> {
    const id = toNumberArray(query.id)[0] || 0;
    const identifier = String(query.identifier || '');

    let row: Article | null = null;
    if (id > 0) {
      row = await this.articleRepo.findOne({ where: { id } });
    } else if (identifier) {
      row = await this.articleRepo.findOne({ where: { identifier } });
      if (row) row.view_count += 1;
    }
    if (!row) throw Biz.notFound('文章不存在');

    const isAdmin = user
      ? await this.permissionService.isAdmin(user.userId)
      : false;
    if (row.status !== ARTICLE_STATUS_PASS) {
      if (!isAdmin && (!user || user.userId !== row.user_id)) {
        throw Biz.notFound('文章不存在或没有权限查看');
      }
    }

    if (identifier && row.id > 0) {
      await this.articleRepo.update(row.id, { view_count: row.view_count });
    }

    return (await this.attachListMeta([row]))[0];
  }

  async list(
    query: Record<string, any>,
    user?: JwtUser,
  ): Promise<{ total: number; article: any[] }> {
    const page = Math.max(1, Number(query.page) || 1);
    const size = Number(query.size) || 10;
    const isAdmin = user
      ? await this.permissionService.isAdmin(user.userId)
      : false;

    const qb = this.articleRepo.createQueryBuilder('a');
    qb.where('a.deleted_at IS NULL');

    if (!isAdmin) {
      qb.andWhere('a.status = :pass', { pass: ARTICLE_STATUS_PASS });
    } else {
      const status = toNumberArray(query.status);
      if (status.length) qb.andWhere('a.status IN (:...status)', { status });
      if (query.wd) {
        qb.andWhere(
          '(a.title LIKE :wd OR a.keywords LIKE :wd OR a.description LIKE :wd)',
          { wd: `%${query.wd}%` },
        );
      }
    }

    const categoryIds = toNumberArray(query.category_id);
    if (categoryIds.length) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM ${tb('article_category')} ac WHERE ac.article_id = a.id AND ac.category_id IN (:...categoryIds))`,
        { categoryIds },
      );
    }

    const userIds = toNumberArray(query.user_id);
    if (userIds.length) qb.andWhere('a.user_id IN (:...userIds)', { userIds });

    const isRecommend = toBoolArray(query.is_recommend);
    if (isRecommend.length === 1) {
      if (isRecommend[0]) qb.andWhere('a.recommend_at IS NOT NULL');
      else qb.andWhere('a.recommend_at IS NULL');
    }

    const isNotice = toNumberArray(query.is_notice);
    if (isNotice.length === 1) {
      qb.andWhere('a.is_notice = :isNotice', { isNotice: isNotice[0] ? 1 : 0 });
    }

    this.applyCreatedAtRange(qb, query.created_at);

    const orderField =
      typeof query.order === 'string' && ALLOWED_SORT.has(query.order)
        ? query.order
        : 'id';
    qb.orderBy(`a.${orderField}`, 'DESC');

    const total = await qb.getCount();
    qb.select(ARTICLE_LIST_COLUMNS.map((c) => `a.${c}`))
      .skip((page - 1) * size)
      .take(size);
    const rows = await qb.getMany();

    return { total, article: await this.attachListMeta(rows) };
  }

  private applyCreatedAtRange(qb: any, value: unknown): void {
    const arr = Array.isArray(value) ? value : value ? [value] : [];
    if (!arr.length) return;
    const start = new Date(String(arr[0]));
    const end = arr.length > 1 ? new Date(String(arr[1])) : new Date();
    if (!Number.isNaN(start.getTime())) {
      qb.andWhere('a.created_at >= :createdStart', { createdStart: start });
    }
    if (!Number.isNaN(end.getTime())) {
      qb.andWhere('a.created_at <= :createdEnd', { createdEnd: end });
    }
  }

  // ---------- 分类 / 推荐 / 审核 ----------

  async setArticlesCategory(
    articleIds: unknown,
    categoryIds: unknown,
  ): Promise<Record<string, never>> {
    const aidList = uniqueNumberArray(toNumberArray(articleIds));
    const cidList = uniqueNumberArray(toNumberArray(categoryIds));

    await this.articleRepo.manager.transaction(async (manager) => {
      for (const id of aidList) {
        const old = await manager.find(ArticleCategory, { where: { article_id: id } });
        for (const o of old) {
          if (o.category_id > 0) {
            await manager.increment(Category, { id: o.category_id }, 'doc_count', -1);
          }
        }
        await manager.delete(ArticleCategory, { article_id: id });

        if (cidList.length) {
          const now = new Date();
          const rows = cidList.map((cid) =>
            manager.create(ArticleCategory, {
              article_id: id,
              category_id: cid,
              created_at: now,
              updated_at: now,
            }),
          );
          await manager.save(rows);
          await manager.increment(Category, { id: In(cidList) }, 'doc_count', 1);
        }
      }
    });

    return {};
  }

  async recommendArticles(
    articleIds: unknown,
    isRecommend: boolean,
  ): Promise<Record<string, never>> {
    const ids = toNumberArray(articleIds);
    if (!ids.length) return {};
    await this.articleRepo.update({ id: In(ids) }, {
      recommend_at: isRecommend ? new Date() : null,
      updated_at: new Date(),
    });
    return {};
  }

  async checkArticles(
    articleIds: unknown,
    status: number,
    reason = '',
  ): Promise<Record<string, never>> {
    const ids = toNumberArray(articleIds);
    if (!ids.length) return {};
    await this.articleRepo.update({ id: In(ids) }, {
      status,
      reject_reason: reason,
      updated_at: new Date(),
    });
    return {};
  }

  async noticeArticles(
    articleIds: unknown,
    isNotice: boolean,
  ): Promise<Record<string, never>> {
    const ids = toNumberArray(articleIds);
    if (!ids.length) return {};
    await this.articleRepo.update({ id: In(ids) }, {
      is_notice: isNotice ? 1 : 0,
      updated_at: new Date(),
    });
    return {};
  }

  // ---------- 回收站 ----------

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
        select: ['id', 'user_id'],
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
      await manager.delete(Article, { id: In(idList) });
      await manager.delete(ArticleCategory, { article_id: In(idList) });
      await manager.delete(ArticleRelate, { article_id: In(idList) });
    });

    return {};
  }

  async emptyRecycle(): Promise<Record<string, never>> {
    for (;;) {
      const rows = await this.articleRepo.find({
        where: { deleted_at: Not(IsNull()) },
        select: ['id'],
        take: 100,
      });
      const ids = rows.map((r) => r.id);
      if (!ids.length) break;

      await this.articleRepo.manager.transaction(async (manager) => {
        await manager.delete(Article, { id: In(ids) });
        await manager.delete(ArticleCategory, { article_id: In(ids) });
        await manager.delete(ArticleRelate, { article_id: In(ids) });
      });
    }
    return {};
  }

  // ---------- 搜索 / 相关 ----------

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
      pass: ARTICLE_STATUS_PASS,
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
        : typeof query.sort === 'string' && ALLOWED_SORT.has(query.sort)
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
      select: ['id'],
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
        where: { id: In(ids), status: ARTICLE_STATUS_PASS, deleted_at: IsNull() },
        take: 11,
      });
    }

    if (!rows.length) return { article: [] };

    return { article: await this.attachListMeta(rows) };
  }

  // ---------- 内部方法 ----------

  private async canPublishArticle(userId: number): Promise<boolean> {
    if (!userId) return false;
    const group = await this.groupRepo
      .createQueryBuilder('g')
      .select('g.id', 'id')
      .leftJoin(UserGroup, 'ug', 'ug.group_id = g.id')
      .where('ug.user_id = :userId AND g.enable_article = :en', {
        userId,
        en: true,
      })
      .getRawOne();
    return !!group && Number(group.id) > 0;
  }

  private async getDefaultArticleStatus(userId: number): Promise<number> {
    if (!userId) return ARTICLE_STATUS_PENDING;
    const group = await this.groupRepo
      .createQueryBuilder('g')
      .select('g.id', 'id')
      .addSelect('MIN(g.enable_article_approval)', 'enable_article_approval')
      .leftJoin(UserGroup, 'ug', 'ug.group_id = g.id')
      .where('ug.user_id = :userId AND g.enable_article = :en', {
        userId,
        en: true,
      })
      .getRawOne();
    if (group && Number(group.id) > 0 && Number(group.enable_article_approval) === 0) {
      return ARTICLE_STATUS_PASS;
    }
    return ARTICLE_STATUS_PENDING;
  }

  private fixKeywordsAndDescription(article: Article): void {
    if (!String(article.description || '').trim()) {
      article.description = substr(stripHtml(article.content), 200);
    }
    if (!String(article.keywords || '').trim()) {
      article.keywords = (article.title || '').trim();
    }
  }

  private articleToReply(
    row: Article,
    categoryIds: number[],
    categories?: any[],
    userObj?: any,
  ): any {
    return {
      id: row.id,
      identifier: row.identifier,
      user_id: row.user_id,
      view_count: row.view_count,
      favorite_count: row.favorite_count,
      comment_count: row.comment_count,
      title: row.title,
      keywords: row.keywords,
      description: row.description,
      content: row.content,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
      recommend_at: row.recommend_at,
      is_recommend: !!row.recommend_at,
      status: row.status,
      is_notice: !!row.is_notice,
      reject_reason: row.reject_reason,
      source: row.source,
      source_url: row.source_url,
      category_id: categoryIds,
      category: categories || [],
      user: userObj,
    };
  }

  private async attachListMeta(rows: Article[]): Promise<any[]> {
    if (!rows.length) return [];

    const ids = rows.map((r) => r.id);
    const acs = await this.articleCategoryRepo.find({
      where: { article_id: In(ids) },
    });
    const byArticle: Record<number, number[]> = {};
    const catIdSet = new Set<number>();
    for (const ac of acs) {
      (byArticle[ac.article_id] = byArticle[ac.article_id] || []).push(
        ac.category_id,
      );
      catIdSet.add(ac.category_id);
    }

    const catIds = Array.from(catIdSet);
    const catMap: Record<number, any> = {};
    if (catIds.length) {
      const cats = await this.categoryRepo.find({
        where: { id: In(catIds) },
        select: ['id', 'title', 'parent_id'],
      });
      for (const c of cats) {
        catMap[c.id] = { id: c.id, title: c.title, parent_id: c.parent_id };
      }
    }

    const userIds = uniqueNumberArray(rows.map((r) => r.user_id));
    const userMap: Record<number, any> = {};
    if (userIds.length) {
      const users = await this.userRepo.find({
        where: { id: In(userIds) },
        select: ['id', 'realname', 'avatar'],
      });
      for (const u of users) {
        userMap[u.id] = {
          id: u.id,
          realname: u.realname,
          avatar: u.avatar,
        };
      }
    }

    return rows.map((r) => {
      const cids = byArticle[r.id] || [];
      const cats = cids.map((cid) => catMap[cid]).filter(Boolean);
      return this.articleToReply(r, cids, cats, userMap[r.user_id]);
    });
  }
}