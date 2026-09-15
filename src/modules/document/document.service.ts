import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThanOrEqual, IsNull } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { v1 as uuidV1 } from 'uuid';
import {
  Document,
  DocumentCategory,
  DocumentRelate,
  DocumentScore,
  DocumentError,
  Category,
  Attachment,
  AttachmentContent,
  User,
  Download,
  DownloadCode,
  Group,
  UserGroup,
} from '../../entities';
import { ConfigService } from '../../config/config.service';
import { ConverterService } from '../converter/converter.service';
import { Biz } from '../../common/biz.exception';

export const DocumentStatus = {
  Pending: 0, // 待转换
  Converting: 1, // 转换中
  Converted: 2, // 已转换
  Failed: 3, // 转换失败
  Disabled: 4, // 已禁用
  RePending: 5, // 重新转换
  PendingReview: 6, // 待审核
  ReviewReject: 7, // 审核拒绝
} as const;

const AttachmentTypeDocument = 2;
const CategoryTypeDocument = 0;

const ORDER_COLUMNS = [
  'id',
  'view_count',
  'download_count',
  'favorite_count',
  'comment_count',
  'created_at',
  'updated_at',
  'recommend_at',
  'score',
  'pages',
  'size',
  'price',
];

const DOCUMENT_EXT_MAP: Record<string, string[]> = {
  pdf: ['.pdf'],
  doc: ['.doc', '.docx', '.rtf', '.wps', '.odt', '.dot'],
  ppt: ['.ppt', '.pptx', '.pps', '.ppsx', '.dps', '.odp', '.pot'],
  xls: ['.xls', '.xlsx', '.et', '.ods', '.csv', '.tsv'],
  txt: ['.txt'],
  other: ['.epub', '.mobi', '.chm', '.umd', '.azw', '.azw3', '.azw4'],
};

interface QueryDocumentsOptions {
  page: number;
  size: number;
  withCount: boolean;
  categoryIds?: number[];
  userIdIds?: number[];
  statuses?: number[];
  wd?: string;
  searchTerms?: string[];
  order?: string;
  recycle?: boolean;
  recommendOnly?: boolean | null;
  feeType?: string;
  exts?: string[];
  languages?: string[];
  createdAtRange?: [Date, Date];
  docIds?: number[];
}

@Injectable()
export class DocumentService implements OnModuleInit {
  private readonly logger = new Logger(DocumentService.name);
  private converting = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(Document)
    private readonly docRepo: Repository<Document>,
    @InjectRepository(DocumentCategory)
    private readonly docCateRepo: Repository<DocumentCategory>,
    @InjectRepository(DocumentRelate)
    private readonly docRelateRepo: Repository<DocumentRelate>,
    @InjectRepository(DocumentScore)
    private readonly scoreRepo: Repository<DocumentScore>,
    @InjectRepository(DocumentError)
    private readonly docErrorRepo: Repository<DocumentError>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    @InjectRepository(AttachmentContent)
    private readonly attachmentContentRepo: Repository<AttachmentContent>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Download)
    private readonly downloadRepo: Repository<Download>,
    @InjectRepository(DownloadCode)
    private readonly downloadCodeRepo: Repository<DownloadCode>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(UserGroup)
    private readonly userGroupRepo: Repository<UserGroup>,
    private readonly config: ConfigService,
    private readonly converter: ConverterService,
    private readonly jwtService: JwtService,
  ) {}

  onModuleInit() {
    // 后台转换轮询 worker，间隔 5 秒处理一个待转换文档
    this.timer = setInterval(() => {
      void this.tick();
    }, 5000);
    this.timer.unref?.();
  }

  // ================== 工具方法 ==================

  private numArray(v: unknown): number[] {
    if (v === undefined || v === null) return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  }

  private strArray(v: unknown): string[] {
    if (v === undefined || v === null) return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((s) => String(s)).filter((s) => s !== '');
  }

  private boolArray(v: unknown): boolean[] {
    if (v === undefined || v === null) return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((b) => b === true || b === 'true' || b === 1 || b === '1');
  }

  private limitRange(n: number, min: number, max: number): number {
    if (n >= max) return max;
    if (n <= min) return min;
    return n;
  }

  private substr(str: string, length: number): string {
    return Array.from(str).slice(0, length).join('');
  }

  private genDocumentUUID(): string {
    const rand = crypto.randomBytes(6).toString('hex').slice(0, 6);
    const h = crypto.createHash('md5').update(uuidV1() + rand).digest('hex');
    return h.slice(8, 24);
  }

  private parseOrder(order?: string): { field: string; dir: 'ASC' | 'DESC' } {
    if (!order) return { field: 'id', dir: 'DESC' };
    const parts = order.trim().split(/\s+/);
    const field = parts[0];
    if (!ORDER_COLUMNS.includes(field)) return { field: 'id', dir: 'DESC' };
    const dir = (parts[1] || 'desc').toLowerCase() === 'asc' ? ('ASC' as const) : ('DESC' as const);
    return { field, dir };
  }

  private extsOf(extType?: string): string[] {
    if (!extType) return [];
    return DOCUMENT_EXT_MAP[extType.trim().toLowerCase()] || [];
  }

  // ================== 文档查询 ==================

  async getDocument(idOrUuid: number | string): Promise<Document> {
    if (typeof idOrUuid === 'number' || /^\d+$/.test(String(idOrUuid))) {
      return this.docRepo.findOne({ where: { id: Number(idOrUuid) } });
    }
    return this.docRepo.findOne({ where: { uuid: String(idOrUuid) } });
  }

  private buildQuery(qb: any, opt: QueryDocumentsOptions): any {
    if (opt.recycle) {
      qb.where('d.deleted_at IS NOT NULL');
    } else {
      qb.where('d.deleted_at IS NULL');
    }

    if (opt.docIds && opt.docIds.length > 0) {
      qb.andWhere('d.id IN (:...docIds)', { docIds: opt.docIds });
    }

    if (opt.userIdIds && opt.userIdIds.length > 0) {
      qb.andWhere('d.user_id IN (:...userIdIds)', { userIdIds: opt.userIdIds });
    }

    if (opt.statuses && opt.statuses.length > 0) {
      qb.andWhere('d.status IN (:...statuses)', { statuses: opt.statuses });
    }

    if (opt.wd && opt.wd.trim() !== '') {
      const wd = `%${opt.wd.trim()}%`;
      qb.andWhere('(d.title LIKE :wd OR d.keywords LIKE :wd OR d.description LIKE :wd)', { wd });
    }

    if (opt.searchTerms && opt.searchTerms.length > 0) {
      const terms = opt.searchTerms.map((t) => `%${t}%`);
      const conds = terms
        .map((_, i) => `(d.title LIKE :term${i} OR d.keywords LIKE :term${i} OR d.description LIKE :term${i})`)
        .join(' AND ');
      const params: Record<string, string> = {};
      terms.forEach((t, i) => (params[`term${i}`] = t));
      qb.andWhere(conds, params);
    }

    if (opt.recommendOnly !== null && opt.recommendOnly !== undefined) {
      if (opt.recommendOnly) {
        qb.andWhere('d.recommend_at IS NOT NULL');
      } else {
        qb.andWhere('d.recommend_at IS NULL');
      }
    }

    if (opt.feeType) {
      if (opt.feeType === 'free') qb.andWhere('d.price = 0');
      else if (opt.feeType === 'charge') qb.andWhere('d.price > 0');
    }

    if (opt.exts && opt.exts.length > 0) {
      qb.andWhere('d.ext IN (:...exts)', { exts: opt.exts });
    }

    if (opt.languages && opt.languages.length > 0) {
      qb.andWhere('d.language IN (:...languages)', { languages: opt.languages });
    }

    if (opt.createdAtRange) {
      qb.andWhere('d.created_at >= :start AND d.created_at <= :end', {
        start: opt.createdAtRange[0],
        end: opt.createdAtRange[1],
      });
    }

    return qb;
  }

  private async queryDocuments(opt: QueryDocumentsOptions): Promise<{ docs: Document[]; total: number }> {
    let docIds = opt.docIds ? [...opt.docIds] : undefined;
    if (opt.categoryIds && opt.categoryIds.length > 0) {
      const cates = await this.docCateRepo.find({
        where: { category_id: In(opt.categoryIds) },
        select: ['document_id'],
      });
      const cids = [...new Set(cates.map((c) => Number(c.document_id)))];
      if (cids.length === 0) return { docs: [], total: 0 };
      docIds = docIds ? docIds.filter((id) => cids.includes(id)) : cids;
      if (docIds.length === 0) return { docs: [], total: 0 };
    }

    const finalOpt: QueryDocumentsOptions = { ...opt, docIds };
    const qb = this.docRepo.createQueryBuilder('d');
    this.buildQuery(qb, finalOpt);

    if (opt.recycle) {
      qb.orderBy('d.deleted_at', 'DESC').addOrderBy('d.id', 'DESC');
    } else {
      const order = this.parseOrder(opt.order);
      qb.orderBy(`d.${order.field}`, order.dir);
    }

    qb.skip((opt.page - 1) * opt.size).take(opt.size);

    const [docs, total] = await qb.getManyAndCount();
    return { docs, total: opt.withCount ? total : 0 };
  }

  private async enrichDocuments(
    docs: Document[],
    opts: { withCategories?: boolean; withCover?: boolean; userId?: number; maskCounts?: boolean } = {},
  ): Promise<Record<string, any>[]> {
    if (docs.length === 0) return [];

    const docIds = docs.map((d) => Number(d.id));
    const userIds = new Set<number>();
    docs.forEach((d) => {
      if (d.user_id > 0) userIds.add(Number(d.user_id));
      if (d.deleted_user_id > 0) userIds.add(Number(d.deleted_user_id));
    });

    const users = userIds.size > 0 ? await this.userRepo.find({ where: { id: In([...userIds]) } }) : [];
    const userMap = new Map<number, User>();
    users.forEach((u) => userMap.set(Number(u.id), u));

    const cates = await this.docCateRepo.find({ where: { document_id: In(docIds) } });
    const cateIds = new Set<number>();
    const docCateMap = new Map<number, number[]>();
    cates.forEach((c) => {
      const did = Number(c.document_id);
      if (!docCateMap.has(did)) docCateMap.set(did, []);
      docCateMap.get(did)!.push(Number(c.category_id));
      cateIds.add(Number(c.category_id));
    });

    let cateMap = new Map<number, Category>();
    if (cateIds.size > 0) {
      const categories = await this.categoryRepo.find({ where: { id: In([...cateIds]) } });
      categories.forEach((c) => cateMap.set(Number(c.id), c));
    }

    const attachments = await this.attachmentRepo.find({ where: { type: AttachmentTypeDocument, type_id: In(docIds) } });
    const hashMap = new Map<number, string>();
    attachments.forEach((a) => hashMap.set(Number(a.type_id), a.hash));

    const errors = await this.docErrorRepo.find({ where: { id: In(docIds) } });
    const errorMap = new Map<number, string>();
    errors.forEach((e) => errorMap.set(Number(e.id), e.message));

    const maskCounts = opts.maskCounts ?? false;
    const showDownload = this.config.getBool('display', 'show_document_download_count', true);
    const showView = this.config.getBool('display', 'show_document_view_count', true);
    const showFavorite = this.config.getBool('display', 'show_document_favorite_count', true);

    const result: Record<string, any>[] = [];
    for (const doc of docs) {
      const item: Record<string, any> = { ...doc };
      const uid = Number(doc.user_id);
      const isOwner = opts.userId !== undefined && opts.userId > 0 && opts.userId === uid;

      item.category_id = docCateMap.get(Number(doc.id)) || [];
      item.realname = userMap.get(uid)?.realname || '';
      item.deleted_realname = userMap.get(Number(doc.deleted_user_id))?.realname || '';
      const hash = hashMap.get(Number(doc.id)) || '';
      item.attachment = hash ? { hash } : null;
      item.convert_error = errorMap.get(Number(doc.id)) || '';
      if (opts.withCover && hash) {
        item.cover = `/view/cover/${hash}`;
      }
      if (opts.withCategories) {
        const cateList = (item.category_id as number[])
          .map((cid) => cateMap.get(cid))
          .filter(Boolean)
          .map((c) => ({ id: Number(c!.id), title: c!.title, parent_id: c!.parent_id }));
        item.category = cateList;
      }

      if (maskCounts && !isOwner) {
        if (!showDownload) item.download_count = 0;
        if (!showView) item.view_count = 0;
        if (!showFavorite) item.favorite_count = 0;
      }
      result.push(item);
    }
    return result;
  }

  private async canAccessUploadDocument(userId: number): Promise<boolean> {
    if (userId <= 0) return false;
    const userGroups = await this.userGroupRepo.find({ where: { user_id: userId } });
    const groupIds = userGroups.map((ug) => Number(ug.group_id)).filter((id) => id > 0);
    if (groupIds.length === 0) return false;
    const group = await this.groupRepo.findOne({ where: { id: In(groupIds), enable_upload: true } });
    return !!group;
  }

  async defaultDocumentStatus(userId: number): Promise<number> {
    if (userId <= 0) return DocumentStatus.PendingReview;
    const userGroups = await this.userGroupRepo.find({ where: { user_id: userId } });
    const groupIds = userGroups.map((ug) => Number(ug.group_id)).filter((id) => id > 0);
    if (groupIds.length === 0) return DocumentStatus.PendingReview;
    const groups = await this.groupRepo.find({ where: { id: In(groupIds) } });
    // 任一用户组关闭审核即视为无需审核（与原版 min(enable_document_review) 对齐）
    if (groups.some((g) => g.enable_document_review === false)) {
      return DocumentStatus.Pending;
    }
    return DocumentStatus.PendingReview;
  }

  // ================== 创建 / 更新 / 删除 ==================

  async createDocument(userId: number, categoryIds: number[], items: any[]): Promise<void> {
    if (!(await this.canAccessUploadDocument(userId))) {
      throw Biz.permissionDenied('没有权限上传文档');
    }
    const attachmentIds = items.map((it) => Number(it.attachment_id)).filter((n) => n > 0);
    if (attachmentIds.length === 0) throw Biz.invalidArgument('文档文件参数attachment_id不正确');

    const attachments = await this.attachmentRepo.find({
      where: { id: In(attachmentIds), user_id: userId },
    });
    if (attachments.length === 0) throw Biz.invalidArgument('文档文件参数attachment_id不正确');

    const attachMap = new Map<number, Attachment>();
    attachments.forEach((a) => attachMap.set(Number(a.id), a));

    const status = await this.defaultDocumentStatus(userId);
    const prepared: Array<{ doc: Partial<Document>; attachmentId: number }> = [];

    for (const it of items) {
      const attachment = attachMap.get(Number(it.attachment_id));
      if (!attachment) continue;
      let keywords = String(it.keywords ?? '').trim();
      if (!keywords) {
        keywords = String(it.title ?? '').replace(/，/g, ', ');
      }
      const description = this.substr(String(it.description ?? '').trim(), 512);
      prepared.push({
        doc: {
          title: String(it.title ?? '').slice(0, 255),
          keywords,
          description,
          user_id: userId,
          score: 300,
          price: Number(it.price) || 0,
          size: Number(attachment.size) || 0,
          ext: attachment.ext || '',
          status,
          uuid: this.genDocumentUUID(),
          language: String(it.language ?? ''),
          source: String(it.source ?? ''),
          source_url: String(it.source_url ?? ''),
          preview_ext: '.webp',
          created_at: new Date(),
          updated_at: new Date(),
        },
        attachmentId: Number(attachment.id),
      });
    }

    if (prepared.length === 0) throw Biz.invalidArgument('文档文件参数attachment_id不正确');

    const queryRunner = this.docRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const docCount = prepared.length;
      if (categoryIds.length > 0) {
        await queryRunner.manager
          .createQueryBuilder()
          .update(Category)
          .set({ doc_count: () => `doc_count + ${docCount}` })
          .where('id IN (:...ids)', { ids: categoryIds })
          .execute();
      }

      const created = await queryRunner.manager.save(
        Document,
        prepared.map((p) => p.doc),
      );

      const docCates: Partial<DocumentCategory>[] = [];
      for (const d of created) {
        for (const cid of categoryIds) {
          docCates.push({ document_id: Number(d.id), category_id: cid });
        }
      }
      if (docCates.length > 0) {
        await queryRunner.manager.save(DocumentCategory, docCates);
      }

      await queryRunner.manager
        .createQueryBuilder()
        .update(User)
        .set({ doc_count: () => `doc_count + ${docCount}` })
        .where('id = :id', { id: userId })
        .execute();

      // 附件关联文档（保持与创建顺序一致）
      for (let i = 0; i < created.length; i++) {
        const attachmentId = prepared[i].attachmentId;
        await queryRunner.manager
          .createQueryBuilder()
          .update(Attachment)
          .set({ type_id: Number(created[i].id) })
          .where('id = :id', { id: attachmentId })
          .execute();
      }

      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  async updateDocument(userId: number, isAdminFlag: boolean, body: any): Promise<void> {
    const id = Number(body.id);
    if (!id) throw Biz.invalidArgument('文档ID不能为空');
    const exist = await this.docRepo.findOne({ where: { id } });
    if (!exist) throw Biz.notFound('文档不存在');
    if (!isAdminFlag && Number(exist.user_id) !== userId) {
      throw Biz.permissionDenied('文档不存在或没有权限');
    }

    const fields: Partial<Document> = {
      title: String(body.title ?? exist.title).slice(0, 255),
      keywords: String(body.keywords ?? exist.keywords),
      description: String(body.description ?? exist.description),
      price: body.price !== undefined ? Number(body.price) : exist.price,
      language: String(body.language ?? exist.language),
      source: String(body.source ?? exist.source),
      source_url: String(body.source_url ?? exist.source_url),
      updated_at: new Date(),
    };
    if (isAdminFlag && body.status !== undefined) {
      fields.status = Number(body.status);
    }

    const categoryIds = this.numArray(body.category_id);

    const queryRunner = this.docRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const oldCates = await queryRunner.manager.find(DocumentCategory, { where: { document_id: id } });
      const oldIds = oldCates.map((c) => Number(c.category_id));
      if (oldIds.length > 0) {
        await queryRunner.manager
          .createQueryBuilder()
          .update(Category)
          .set({ doc_count: () => `doc_count - 1` })
          .where('id IN (:...ids)', { ids: oldIds })
          .execute();
        await queryRunner.manager.delete(DocumentCategory, { document_id: id });
      }
      if (categoryIds.length > 0) {
        const docCates = categoryIds.map((cid) => ({ document_id: id, category_id: cid }));
        await queryRunner.manager.save(DocumentCategory, docCates);
        await queryRunner.manager
          .createQueryBuilder()
          .update(Category)
          .set({ doc_count: () => `doc_count + 1` })
          .where('id IN (:...ids)', { ids: categoryIds })
          .execute();
      }
      await queryRunner.manager.update(Document, id, fields);
      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  async deleteDocument(userId: number, isAdminFlag: boolean, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    let targetIds = ids;
    if (!isAdminFlag) {
      const docs = await this.docRepo.find({ where: { id: In(ids), user_id: userId }, select: ['id'] } as any);
      targetIds = docs.map((d) => Number(d.id));
      if (targetIds.length === 0) throw Biz.permissionDenied('文档不存在或没有删除权限');
    }

    const queryRunner = this.docRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const docs = await queryRunner.manager.find(Document, {
        where: { id: In(targetIds), deleted_at: IsNull() },
        select: ['id', 'user_id', 'deleted_at'],
      } as any);
      const docCates = await queryRunner.manager.find(DocumentCategory, {
        where: { document_id: In(targetIds) },
      });
      const cateByDoc = new Map<number, number[]>();
      docCates.forEach((c) => {
        const did = Number(c.document_id);
        if (!cateByDoc.has(did)) cateByDoc.set(did, []);
        cateByDoc.get(did)!.push(Number(c.category_id));
      });

      for (const doc of docs) {
        const did = Number(doc.id);
        const cids = cateByDoc.get(did) || [];
        if (cids.length > 0) {
          await queryRunner.manager
            .createQueryBuilder()
            .update(Category)
            .set({ doc_count: () => `doc_count - 1` })
            .where('id IN (:...ids)', { ids: cids })
            .execute();
        }
        const uid = Number(doc.user_id);
        if (uid > 0) {
          await queryRunner.manager
            .createQueryBuilder()
            .update(User)
            .set({ doc_count: () => `doc_count - 1` })
            .where('id = :id', { id: uid })
            .execute();
        }
      }

      await queryRunner.manager
        .createQueryBuilder()
        .update(Document)
        .set({ deleted_at: new Date(), deleted_user_id: userId })
        .where('id IN (:...ids)', { ids: targetIds })
        .execute();
      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  // ================== 列表 / 搜索 / 首页 ==================

  async listDocument(params: any, userId: number, isAdminFlag: boolean): Promise<Record<string, any>> {
    let page = Number(params.page) || 1;
    let size = Number(params.size) || 24;
    const limit = Number(params.limit) || 0;
    if (limit > 0) {
      page = 1;
      size = limit;
    }
    if (page < 1) page = 1;
    if (size < 1) size = 24;

    const categoryIds = this.numArray(params.category_id);
    const requestUserIds = this.numArray(params.user_id);
    const requestStatuses = this.numArray(params.status);
    const recommendArr = this.boolArray(params.is_recommend);
    const languages = this.strArray(params.language)
      .map((l) => String(l).trim())
      .filter(Boolean);

    const queryOwn = requestUserIds.length === 1 && requestUserIds[0] === userId;

    let statuses: number[] = [];
    if (isAdminFlag || queryOwn) {
      statuses = requestStatuses;
    } else {
      const allowed: number[] = [DocumentStatus.Pending, DocumentStatus.Converting, DocumentStatus.Converted, DocumentStatus.Failed];
      if (requestStatuses.length === 1 && allowed.includes(requestStatuses[0])) {
        statuses = [requestStatuses[0]];
      } else {
        statuses = allowed;
        if (size > 24) size = 24;
      }
    }

    const opt: QueryDocumentsOptions = {
      page,
      size,
      withCount: true,
      categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
      userIdIds: requestUserIds.length > 0 ? requestUserIds : undefined,
      statuses: statuses.length > 0 ? statuses : undefined,
      wd: String(params.wd || ''),
      order: String(params.order || ''),
      recommendOnly: recommendArr.length === 1 ? recommendArr[0] : null,
      feeType: String(params.fee_type || ''),
      exts: this.extsOf(String(params.ext || '')),
      languages: languages.length > 0 ? languages : undefined,
      createdAtRange: this.parseCreatedAtRange(params.created_at),
    };

    const { docs, total } = await this.queryDocuments(opt);
    const list = await this.enrichDocuments(docs, {
      withCategories: true,
      userId,
      maskCounts: !isAdminFlag,
    });
    return { total, document: list };
  }

  async listDocumentForHome(params: any): Promise<Record<string, any>> {
    const categories = await this.categoryRepo.find({
      where: { enable: true, parent_id: 0, type: CategoryTypeDocument },
      order: { sort: 'ASC' },
    });
    if (categories.length === 0) return { document: [] };

    let limit = Number(params.limit) || 5;
    limit = this.limitRange(limit, 1, 100);

    const resp: any[] = [];
    const allDocs: Document[] = [];
    for (const category of categories) {
      const { docs } = await this.queryDocuments({
        page: 1,
        size: limit,
        withCount: false,
        categoryIds: [Number(category.id)],
        statuses: [DocumentStatus.Converted],
        order: 'id desc',
      });
      allDocs.push(...docs);
      resp.push({
        category_id: Number(category.id),
        category_name: category.title,
        category_cover: category.cover,
        document: docs,
      });
    }

    const hashMap = await this.attachmentHashMap(allDocs.map((d) => Number(d.id)));
    for (const item of resp) {
      item.document = (item.document as Document[]).map((d) => {
        const hash = hashMap.get(Number(d.id)) || '';
        return { ...d, cover: hash ? `/view/cover/${hash}` : '' };
      });
    }
    return { document: resp };
  }

  async searchDocument(params: any): Promise<Record<string, any>> {
    const started = Date.now();
    const wd = String(params.wd || '').trim();
    const res: Record<string, any> = { total: 0, spend: '0.000', document: [] };
    if (!wd) return res;

    const maxPages = this.config.getInt('display', 'max_search_pages', 100);
    let page = Number(params.page) || 1;
    if (page < 1) page = 1;
    let size = this.limitRange(Number(params.size) || 24, 1, 24);
    page = this.limitRange(page, 1, maxPages > 0 ? maxPages : 10000);

    const categoryIds = this.numArray(params.category_id);
    const languages = this.strArray(params.language)
      .map((l) => String(l).trim())
      .filter(Boolean);
    const terms = wd.split(/\s+/).filter(Boolean);

    let order = String(params.sort || '');
    if (order === 'latest') order = 'id desc';

    const opt: QueryDocumentsOptions = {
      page,
      size,
      withCount: true,
      categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
      userIdIds: Number(params.user_id) > 0 ? [Number(params.user_id)] : undefined,
      searchTerms: terms,
      order,
      exts: this.extsOf(String(params.ext || '')),
      languages: languages.length > 0 ? languages : undefined,
      createdAtRange: this.parseCreatedAtRange(params.created_at),
    };

    const { docs, total } = await this.queryDocuments(opt);
    const list = await this.enrichDocuments(docs, { withCategories: false, userId: 0, maskCounts: false });
    list.forEach((d) => {
      d.download_count = 0;
      d.view_count = 0;
      d.favorite_count = 0;
    });

    res.total = maxPages > 0 && total > maxPages * size ? maxPages * size : total;
    res.spend = ((Date.now() - started) / 1000).toFixed(3);
    res.document = list;
    return res;
  }

  async getDocumentDetail(params: any, userId: number, isAdminFlag: boolean): Promise<Record<string, any>> {
    const rawId = Number(params.id);
    const idOrUuid: number | string = rawId > 0 ? rawId : String(params.uuid || '');
    if (idOrUuid === '' || (typeof idOrUuid === 'number' && idOrUuid <= 0)) {
      throw Biz.notFound('文档不存在');
    }
    const doc = await this.getDocument(idOrUuid);
    if (!doc || Number(doc.id) === 0) throw Biz.notFound('文档不存在');

    const uid = Number(doc.user_id);
    const isOwner = userId > 0 && userId === uid;
    if (
      (Number(doc.status) === DocumentStatus.ReviewReject ||
        Number(doc.status) === DocumentStatus.PendingReview ||
        Number(doc.status) === DocumentStatus.Disabled) &&
      !(isOwner || isAdminFlag)
    ) {
      throw Biz.notFound('文档不存在');
    }

    const viewCount = Number(doc.view_count) + 1;
    const withAuthor = !!params.with_author;
    if (withAuthor) {
      await this.docRepo.update(doc.id, { view_count: viewCount });
    }

    const enriched = await this.enrichDocuments([doc], {
      withCategories: true,
      userId,
      maskCounts: !isAdminFlag,
    });
    const item = enriched[0];

    const attachment = await this.attachmentRepo.findOne({
      where: { type: AttachmentTypeDocument, type_id: Number(doc.id) },
      order: { id: 'DESC' },
    } as any);
    let content = '';
    if (attachment) {
      const ac = await this.attachmentContentRepo.findOne({ where: { hash: attachment.hash } });
      content = ac?.content || '';
    }
    if (!String(item.description || '').trim() && content) {
      item.description = this.substr(content, 255);
    }
    item.content = params.with_all_content ? content : this.substr(content, 2048 * 4);

    if (withAuthor) {
      const user = await this.userRepo.findOne({ where: { id: uid } });
      item.user = user
        ? { id: Number(user.id), avatar: user.avatar, realname: user.realname, identity: user.identity }
        : null;
    } else {
      item.user = null;
    }
    item.view_count = withAuthor ? viewCount : Number(doc.view_count);
    return item;
  }

  async getRelatedDocuments(id: number): Promise<Record<string, any>> {
    const duration = this.config.getInt('security', 'document_related_duration', 7);
    if (duration <= 0) return { total: 0, document: [] };

    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) return { total: 0, document: [] };

    const terms = String(doc.keywords || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);

    const qb = this.docRepo.createQueryBuilder('d');
    qb.where('d.deleted_at IS NULL');
    qb.andWhere('d.status = :status', { status: DocumentStatus.Converted });
    qb.andWhere('d.id != :id', { id });
    if (terms.length > 0) {
      const conds = terms
        .map((_, i) => `(d.title LIKE :t${i} OR d.keywords LIKE :t${i} OR d.description LIKE :t${i})`)
        .join(' OR ');
      const params: Record<string, string> = {};
      terms.forEach((t, i) => (params[`t${i}`] = `%${t}%`));
      qb.andWhere(`(${conds})`, params);
    }
    qb.orderBy('d.id', 'DESC').take(11);

    const docs = await qb.getMany();
    const list = await this.enrichDocuments(docs, { withCategories: false });
    return { total: list.length, document: list };
  }

  // ================== 下载 ==================

  async downloadDocument(id: number, userId: number, ip: string, downcode = ''): Promise<Record<string, any>> {
    const cfgGuest = this.config.getBool('download', 'enable_guest_download', false);
    if (userId <= 0 && !cfgGuest) {
      throw Biz.unauthenticated('您未登录或您的登录已过期，请重新登录或刷新页面重试');
    }

    const timesEveryDay = this.config.getInt('download', 'times_every_day', 10);
    const timesEveryIP = this.config.getInt('download', 'times_every_ip', 10);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const ipCount = await this.downloadRepo.count({ where: { ip, created_at: MoreThanOrEqual(todayStart) } });
    if (ipCount >= timesEveryIP) {
      throw Biz.permissionDenied(`您所在IP今日下载次数已达上限(${timesEveryIP})`);
    }
    if (userId > 0) {
      const userCount = await this.downloadRepo.count({ where: { user_id: userId, created_at: MoreThanOrEqual(todayStart) } });
      if (userCount >= timesEveryDay) {
        throw Biz.permissionDenied(`您的账户今日下载次数已达上限(${timesEveryDay})`);
      }
    }

    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc || Number(doc.status) === DocumentStatus.Disabled) throw Biz.notFound('文档不存在');

    if (Number(doc.price) > 0 && userId <= 0) {
      throw Biz.permissionDenied('付费文档，请先登录再下载');
    }

    const attachment = await this.attachmentRepo.findOne({
      where: { type: AttachmentTypeDocument, type_id: id },
      order: { id: 'DESC' },
    } as any);
    if (!attachment) throw Biz.notFound('附件不存在');

    const creditName = this.config.get('score', 'credit_name', '魔豆');
    const price = Number(doc.price);
    const isOwner = Number(doc.user_id) === userId;
    let isPay = price > 0 && !isOwner;

    if (!isOwner) {
      if (await this.isOwnedDocument(userId, id)) {
        isPay = false;
      } else if (downcode) {
        await this.consumeDownloadCode(downcode, userId, price);
      } else if (price > 0) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        const credit = Number(user?.credit_count) || 0;
        if (credit < price) {
          throw Biz.permissionDenied(`${creditName}不足，无法下载`);
        }
        await this.userRepo.decrement({ id: userId }, 'credit_count', price);
      }
    }

    const down = this.downloadRepo.create({
      user_id: userId,
      document_id: id,
      ip,
      is_pay: isPay,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await this.downloadRepo.save(down);
    await this.docRepo.increment({ id }, 'download_count', 1);

    return { url: this.generateDownloadURL(doc, attachment.hash, id, userId) };
  }

  private async isOwnedDocument(userId: number, documentId: number): Promise<boolean> {
    if (userId <= 0) return false;
    const duration = this.config.getInt('download', 'free_download_duration', 0);
    if (duration <= 0) return false;
    const since = new Date();
    since.setDate(since.getDate() - duration);
    const paid = await this.downloadRepo.findOne({
      where: { user_id: userId, document_id: documentId, is_pay: true, created_at: MoreThanOrEqual(since) },
      order: { id: 'DESC' },
    });
    return !!paid;
  }

  private async consumeDownloadCode(code: string, userId: number, price: number): Promise<void> {
    if (!this.config.getBool('download', 'enable_code_download', false)) {
      throw Biz.permissionDenied('下载码下载功能未启用');
    }
    const maxPrice = this.config.getInt('download', 'max_price', 0);
    if (price > maxPrice) {
      const creditName = this.config.get('score', 'credit_name', '魔豆');
      throw Biz.permissionDenied(`下载码只能免费下载价格不超过${maxPrice}${creditName}的文档`);
    }
    const normalized = String(code).trim();
    if (!normalized) throw Biz.invalidArgument('请输入您的下载码');

    const result = await this.downloadCodeRepo
      .createQueryBuilder()
      .update(DownloadCode)
      .set({ status: 1, user_id: userId, used_at: new Date(), updated_at: new Date() })
      .where('code = :code AND status = 0', { code: normalized })
      .execute();
    const affected = result.affected || 0;

    if (affected === 0) {
      const item = await this.downloadCodeRepo.findOne({ where: { code: normalized } });
      if (!item) throw Biz.notFound('下载码不存在');
      throw Biz.permissionDenied('下载码已使用');
    }
  }

  async downloadDocumentToBeReviewed(id: number, userId: number, ip: string): Promise<Record<string, any>> {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (
      !doc ||
      !(
        Number(doc.status) === DocumentStatus.Disabled ||
        Number(doc.status) === DocumentStatus.PendingReview ||
        Number(doc.status) === DocumentStatus.ReviewReject
      )
    ) {
      throw Biz.notFound('下载失败：文档不存在，或文档不属于待审、审核拒绝或禁用状态');
    }
    const attachment = await this.attachmentRepo.findOne({
      where: { type: AttachmentTypeDocument, type_id: id },
      order: { id: 'DESC' },
    } as any);
    if (!attachment) throw Biz.notFound('附件不存在');

    const down = this.downloadRepo.create({
      user_id: userId,
      document_id: id,
      ip,
      is_pay: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await this.downloadRepo.save(down);

    return { url: this.generateDownloadURL(doc, attachment.hash, id, userId) };
  }

  private generateDownloadURL(doc: Document, hash: string, documentId: number, userId: number): string {
    const secretKey = this.config.get('download', 'secret_key', 'moredoc');
    const urlDuration = this.config.getInt('download', 'url_duration', 60);
    const jti = `${userId}.${hash}.${documentId}`;
    const token = this.jwtService.sign({}, { secret: secretKey, expiresIn: urlDuration, jwtid: jti });
    const filename = encodeURIComponent(String(doc.title) + String(doc.ext || ''));
    return `/download/${token}?user_id=${userId}&document_id=${documentId}&filename=${filename}`;
  }

  // ================== 评分 ==================

  async setDocumentScore(userId: number, body: any): Promise<void> {
    const documentId = Number(body.document_id);
    if (!documentId) throw Biz.invalidArgument('文档ID不能为空');
    const exist = await this.scoreRepo.findOne({ where: { document_id: documentId, user_id: userId } });
    if (exist) throw Biz.permissionDenied('您已经评分过了');

    const doc = await this.docRepo.findOne({ where: { id: documentId } });
    if (!doc) throw Biz.notFound('文档不存在');

    const score = Number(body.score) || 300;
    const queryRunner = this.docRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.manager.save(DocumentScore, {
        document_id: documentId,
        user_id: userId,
        score,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const scoreCount = Number(doc.score_count) + 1;
      const newScore = Math.round((score + Number(doc.score) * Number(doc.score_count)) / scoreCount);
      await queryRunner.manager.update(Document, documentId, { score: newScore, score_count: scoreCount });
      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  async getDocumentScore(userId: number, documentId: number): Promise<Record<string, any>> {
    const score = await this.scoreRepo.findOne({ where: { document_id: documentId, user_id: userId } });
    if (!score) return {};
    return {
      id: Number(score.id),
      document_id: Number(score.document_id),
      user_id: Number(score.user_id),
      score: Number(score.score),
      created_at: score.created_at,
      updated_at: score.updated_at,
    };
  }

  // ================== 推荐 / 审核 / 批量设置 ==================

  async setDocumentRecommend(ids: number[], type: number): Promise<void> {
    if (ids.length === 0) return;
    if (type === 0) {
      await this.docRepo
        .createQueryBuilder()
        .update(Document)
        .set({ recommend_at: null })
        .where('id IN (:...ids)', { ids })
        .execute();
    } else if (type === 1) {
      await this.docRepo
        .createQueryBuilder()
        .update(Document)
        .set({ recommend_at: () => 'NOW()' })
        .where('id IN (:...ids)', { ids })
        .andWhere('recommend_at IS NULL')
        .execute();
    } else if (type === 2) {
      await this.docRepo
        .createQueryBuilder()
        .update(Document)
        .set({ recommend_at: () => 'NOW()' })
        .where('id IN (:...ids)', { ids })
        .execute();
    }
  }

  async checkDocument(ids: number[], status: number): Promise<void> {
    if (ids.length === 0) throw Biz.invalidArgument('文档ID不能为空');
    if (status === DocumentStatus.Converted) {
      await this.docRepo
        .createQueryBuilder()
        .update(Document)
        .set({ status: DocumentStatus.Converted })
        .where('id IN (:...ids)', { ids })
        .andWhere('pages > 0')
        .execute();
      await this.docRepo
        .createQueryBuilder()
        .update(Document)
        .set({ status: DocumentStatus.Pending })
        .where('id IN (:...ids)', { ids })
        .andWhere('pages = 0')
        .execute();
    } else {
      await this.docRepo
        .createQueryBuilder()
        .update(Document)
        .set({ status })
        .where('id IN (:...ids)', { ids })
        .execute();
    }
  }

  async setDocumentReconvert(): Promise<void> {
    await this.docRepo
      .createQueryBuilder()
      .update(Document)
      .set({ status: DocumentStatus.Pending })
      .where('status = :status', { status: DocumentStatus.Failed })
      .execute();
  }

  async setDocumentsCategory(documentIds: number[], categoryIds: number[]): Promise<void> {
    if (documentIds.length === 0 || categoryIds.length === 0) {
      throw Biz.invalidArgument('文档ID和分类ID均不能为空');
    }
    const queryRunner = this.docRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      for (const id of documentIds) {
        const oldCates = await queryRunner.manager.find(DocumentCategory, { where: { document_id: id } });
        const oldIds = oldCates.map((c) => Number(c.category_id));
        if (oldIds.length > 0) {
          await queryRunner.manager
            .createQueryBuilder()
            .update(Category)
            .set({ doc_count: () => `doc_count - 1` })
            .where('id IN (:...ids)', { ids: oldIds })
            .execute();
        }
        await queryRunner.manager.delete(DocumentCategory, { document_id: id });
        const docCates = categoryIds.map((cid) => ({ document_id: id, category_id: cid }));
        await queryRunner.manager.save(DocumentCategory, docCates);
        await queryRunner.manager
          .createQueryBuilder()
          .update(Category)
          .set({ doc_count: () => `doc_count + 1` })
          .where('id IN (:...ids)', { ids: categoryIds })
          .execute();
      }
      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  async setDocumentsLanguage(documentIds: number[], language: string): Promise<void> {
    if (documentIds.length === 0) throw Biz.invalidArgument('文档ID不能为空');
    await this.docRepo
      .createQueryBuilder()
      .update(Document)
      .set({ language })
      .where('id IN (:...ids)', { ids: documentIds })
      .execute();
  }

  // ================== 回收站 ==================

  async listRecycleDocument(params: any): Promise<Record<string, any>> {
    const page = Number(params.page) || 1;
    const size = Number(params.size) || 24;
    const categoryIds = this.numArray(params.category_id);
    const userIdIds = this.numArray(params.user_id);
    const statuses = this.numArray(params.status);

    const { docs, total } = await this.queryDocuments({
      page,
      size,
      withCount: true,
      categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
      userIdIds: userIdIds.length > 0 ? userIdIds : undefined,
      statuses: statuses.length > 0 ? statuses : undefined,
      wd: String(params.wd || ''),
      recycle: true,
    });
    const list = await this.enrichDocuments(docs, { withCategories: true, userId: 0, maskCounts: false });
    return { total, document: list };
  }

  async recoverRecycleDocument(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const queryRunner = this.docRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.manager
        .createQueryBuilder()
        .update(Document)
        .set({ deleted_at: null, deleted_user_id: 0 })
        .where('id IN (:...ids)', { ids })
        .execute();

      const cates = await queryRunner.manager.find(DocumentCategory, { where: { document_id: In(ids) } });
      const cateIds = [...new Set(cates.map((c) => Number(c.category_id)))];
      if (cateIds.length > 0) {
        await queryRunner.manager
          .createQueryBuilder()
          .update(Category)
          .set({ doc_count: () => `doc_count + 1` })
          .where('id IN (:...ids)', { ids: cateIds })
          .execute();
      }
      const docs = await queryRunner.manager.find(Document, {
        where: { id: In(ids) },
        select: ['user_id'],
      } as any);
      const userIds = [...new Set(docs.map((d) => Number(d.user_id)).filter((v) => v > 0))];
      for (const uid of userIds) {
        await queryRunner.manager
          .createQueryBuilder()
          .update(User)
          .set({ doc_count: () => `doc_count + 1` })
          .where('id = :id', { id: uid })
          .execute();
      }
      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  async deleteRecycleDocument(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    // 彻底删除：附件、分类关联、文档本身
    await this.attachmentRepo.delete({ type: AttachmentTypeDocument, type_id: In(ids) });
    await this.docCateRepo.delete({ document_id: In(ids) });
    await this.docRepo.delete(ids);
  }

  async clearRecycleDocument(): Promise<void> {
    const docs = await this.docRepo
      .createQueryBuilder('d')
      .select('d.id')
      .where('d.deleted_at IS NOT NULL')
      .getMany();
    if (docs.length === 0) return;
    const ids = docs.map((d) => Number(d.id));
    await this.deleteRecycleDocument(ids);
  }

  // ================== 转换流水线 ==================

  private async attachmentHashMap(docIds: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (docIds.length === 0) return map;
    const attachments = await this.attachmentRepo.find({ where: { type: AttachmentTypeDocument, type_id: In(docIds) } });
    attachments.forEach((a) => map.set(Number(a.type_id), a.hash));
    return map;
  }

  private parseCreatedAtRange(v: unknown): [Date, Date] | undefined {
    const arr = this.strArray(v);
    if (arr.length === 0) return undefined;
    const start = new Date(arr[0]);
    if (isNaN(start.getTime())) return undefined;
    const end = arr.length > 1 ? new Date(arr[1]) : new Date();
    return [start, isNaN(end.getTime()) ? new Date() : end];
  }

  private makeWorkspace(): string {
    const dir = path.resolve(process.cwd(), 'cache/convert', new Date().toISOString().slice(0, 10), uuidV1());
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private cleanup(workspace: string): void {
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch (e) {
      this.logger.warn(`清理临时目录失败：${(e as Error).message}`);
    }
  }

  private async setConvertError(documentId: number, err: Error): Promise<void> {
    const exist = await this.docErrorRepo.findOne({ where: { id: documentId } });
    if (exist) {
      await this.docErrorRepo.update(documentId, { message: err.message });
    } else {
      await this.docErrorRepo.save({
        id: documentId,
        message: err.message,
        created_at: new Date(),
        updated_at: new Date(),
      } as any);
    }
  }

  private async clearConvertError(documentId: number): Promise<void> {
    await this.docErrorRepo.delete(documentId);
  }

  private async tick(): Promise<void> {
    if (this.converting) return;
    this.converting = true;
    try {
      await this.convertNextDocument();
    } catch (e) {
      this.logger.error(`转换 worker 异常：${(e as Error).message}`);
    } finally {
      this.converting = false;
    }
  }

  private async convertNextDocument(): Promise<void> {
    const doc = await this.docRepo.findOne({
      where: { status: In([DocumentStatus.Pending, DocumentStatus.RePending]) },
      order: { id: 'ASC' },
    });
    if (!doc) return;
    await this.handleDocument(doc);
  }

  private async handleDocument(doc: Document): Promise<void> {
    const documentId = Number(doc.id);
    await this.docRepo.update(documentId, { status: DocumentStatus.Converting });

    const attachment = await this.attachmentRepo.findOne({
      where: { type: AttachmentTypeDocument, type_id: documentId },
      order: { id: 'DESC' },
    } as any);

    if (!attachment) {
      await this.docRepo.update(documentId, { status: DocumentStatus.Failed });
      await this.setConvertError(documentId, new Error('文档附件不存在'));
      return;
    }

    const relPath = String(attachment.path || '').replace(/^\/+/, '');
    const srcPath = path.resolve(process.cwd(), relPath);
    if (!relPath || !fs.existsSync(srcPath)) {
      await this.docRepo.update(documentId, { status: DocumentStatus.Failed });
      await this.setConvertError(documentId, new Error('文档原文件不存在'));
      return;
    }

    const srcExt = path.extname(srcPath);
    const baseDir = srcPath.slice(0, srcPath.length - srcExt.length);
    const coverPath = path.join(baseDir, 'cover.png');
    fs.mkdirSync(baseDir, { recursive: true });

    const cfgExtension = (this.config.get('converter', 'extension', 'webp') || 'webp').toLowerCase();
    const cfgEnableGzip = this.config.getBool('converter', 'enable_gzip', true);
    const cfgMaxPreview = this.config.getInt('converter', 'max_preview', 0);
    const cfgMaxPercent = this.config.getInt('converter', 'max_preview_percent', 100);

    const workspace = this.makeWorkspace();
    try {
      const dstPDF = await this.converter.convertToPDF(srcPath, workspace);
      const pages = await this.converter.countPDFPages(dstPDF);
      if (pages <= 0) throw new Error('统计PDF页数失败');

      let maxPreview = cfgMaxPreview;
      if (cfgMaxPercent > 0 && cfgMaxPercent < 100) {
        let maxPreview2 = Math.ceil((pages * cfgMaxPercent) / 100);
        if (maxPreview2 < 1) maxPreview2 = 1;
        if (maxPreview2 < maxPreview) maxPreview = maxPreview2;
      }
      let preview = maxPreview;
      if (pages < preview) preview = pages;

      let toPage = pages;
      if (maxPreview > 0) toPage = maxPreview;
      if (toPage > pages && pages > 0) toPage = pages;

      const ext = `.${cfgExtension}`;
      const pageList = await this.converter.convertPDFToPages(dstPDF, workspace, 1, toPage, ext);
      if (!pageList || pageList.length === 0) throw new Error('文档预览页转换失败');

      const isSvg = cfgExtension === 'svg';
      const gzipExt = isSvg && cfgEnableGzip;
      const finalExt = gzipExt ? '.gzip.svg' : ext;

      // 生成封面（取第一页）
      if (pageList.length > 0) {
        try {
          await this.converter.generateCover(pageList[0].page_path, coverPath);
        } catch (e) {
          this.logger.warn(`生成封面失败：${(e as Error).message}`);
        }
      }

      // 复制预览页到最终目录
      for (const page of pageList) {
        const finalPath = path.join(baseDir, `${page.page_num}${finalExt}`);
        if (gzipExt) {
          const gz = this.converter.compressSVGByGZIP(page.page_path);
          fs.copyFileSync(gz, finalPath);
        } else {
          fs.copyFileSync(page.page_path, finalPath);
        }
      }

      await this.docRepo.update(documentId, {
        pages,
        preview,
        status: DocumentStatus.Converted,
        enable_gzip: gzipExt,
        preview_ext: isSvg ? '.svg' : ext,
        updated_at: new Date(),
      });
      await this.clearConvertError(documentId);
    } catch (e) {
      this.logger.error(`文档转换失败（id=${documentId}）：${(e as Error).message}`);
      await this.docRepo.update(documentId, { status: DocumentStatus.Failed });
      await this.setConvertError(documentId, e as Error);
    } finally {
      this.cleanup(workspace);
    }
  }
}