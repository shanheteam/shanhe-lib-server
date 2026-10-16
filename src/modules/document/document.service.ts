import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, EntityManager, In, MoreThanOrEqual, IsNull } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
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
import { OssService } from '../attachment/oss.service';
import { Biz } from '../../common/biz.exception';
import { asArray, positiveNumberArray, toBoolArray } from '../../common/query.util';
import { sanitizeHttpUrl } from '../../common/url.util';
import { tb } from '../../database/naming-strategy';
import {
  DocumentStatus,
  AttachmentTypeDocument,
  CategoryTypeDocument,
} from './document.constant';
import { ConversionWorkerService } from './split/conversion-worker.service';
import { DownloadService } from './split/download.service';

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
  private timer: NodeJS.Timeout | null = null;
  private readonly conversionWorker: ConversionWorkerService;
  private readonly downloadService: DownloadService;

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
    private readonly ossService: OssService,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {
    this.conversionWorker = new ConversionWorkerService(
      this.docRepo,
      this.attachmentRepo,
      this.docErrorRepo,
      this.config,
      this.converter,
      this.ossService,
      this.logger,
    );
    this.downloadService = new DownloadService(
      this.downloadRepo,
      this.downloadCodeRepo,
      this.docRepo,
      this.attachmentRepo,
      this.config,
      this.jwtService,
      this.dataSource,
    );
  }

  onModuleInit() {
    // 后台转换轮询 worker，间隔 5 秒处理一个待转换文档
    this.timer = setInterval(() => {
      void this.conversionWorker.tick();
    }, 5000);
    this.timer.unref?.();
  }

  // ================== 工具方法 ==================

  private limitRange(n: number, min: number, max: number): number {
    if (n >= max) return max;
    if (n <= min) return min;
    return n;
  }

  /**
   * 按「码点」截断字符串，语义等价于 Array.from(str).slice(0, length).join('')。
   * 原实现会把整段字符串展开成等长数组：文档正文是 longtext，可达数 MB，
   * 每次打开详情页都会因此产生一个百万级元素的临时数组（几十 MB 内存 + GC 抖动）。
   * 这里只展开「前 length 个码点所需」的有限前缀；纯 BMP 文本（无代理对）直接 slice。
   */
  private substr(str: string, length: number): string {
    if (!str) return '';
    // 无增补平面字符时，码点数与 UTF-16 长度一致，直接 slice 结果完全相同
    if (!/[\uD800-\uDFFF]/.test(str)) return str.slice(0, length);
    // 含代理对：每个码点最多占 2 个 UTF-16 单元，取 length*2 个单元即可覆盖前 length 个码点
    return Array.from(str.slice(0, length * 2)).slice(0, length).join('');
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

  // 覆盖式同步单个文档与分类的多对多关联：扣除旧分类计数并删除旧关联，
  // 再插入新关联并累计新分类计数。事务由调用方开启，需传入管理器对象。
  private async syncDocumentCategories(
    em: EntityManager,
    documentId: number,
    categoryIds: number[],
  ): Promise<void> {
    const oldCates = await em.find(DocumentCategory, { where: { document_id: documentId } });
    const oldIds = oldCates.map((c) => Number(c.category_id));
    if (oldIds.length > 0) {
      await em
        .createQueryBuilder()
        .update(Category)
        .set({ doc_count: () => `doc_count - 1` })
        .where('id IN (:...ids)', { ids: oldIds })
        .execute();
      await em.delete(DocumentCategory, { document_id: documentId });
    }
    if (categoryIds.length > 0) {
      const docCates = categoryIds.map((cid) => ({ document_id: documentId, category_id: cid }));
      await em.save(DocumentCategory, docCates);
      await em
        .createQueryBuilder()
        .update(Category)
        .set({ doc_count: () => `doc_count + 1` })
        .where('id IN (:...ids)', { ids: categoryIds })
        .execute();
    }
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

    if (opt.categoryIds && opt.categoryIds.length > 0) {
      // 分类过滤下推到 SQL：命中任一分类即可，等价于原先在内存中做 document_id 交集。
      // 注意命名策略会为表名加 mnt_ 前缀，必须用 tb() 生成真实表名
      qb.andWhere(
        `EXISTS (SELECT 1 FROM ${tb('document_category')} dc WHERE dc.document_id = d.id AND dc.category_id IN (:...categoryIds))`,
        { categoryIds: opt.categoryIds },
      );
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
    const qb = this.docRepo.createQueryBuilder('d');
    this.buildQuery(qb, opt);

    if (opt.recycle) {
      qb.orderBy('d.deleted_at', 'DESC').addOrderBy('d.id', 'DESC');
    } else {
      const order = this.parseOrder(opt.order);
      qb.orderBy(`d.${order.field}`, order.dir);
    }

    qb.skip((opt.page - 1) * opt.size).take(opt.size);

    // 不需要总数时跳过 COUNT 查询
    if (!opt.withCount) {
      const docs = await qb.getMany();
      return { docs, total: 0 };
    }

    const [docs, total] = await qb.getManyAndCount();
    return { docs, total };
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

    // 只取用得到的列：原实现取全列，会把 password 哈希与 address/signature 等长文本
    // 一并从数据库拉进内存（列表接口每批文档都要走一次），此处仅需 realname。
    const users =
      userIds.size > 0
        ? await this.userRepo.find({ select: { id: true, realname: true }, where: { id: In([...userIds]) } })
        : [];
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

    const cateMap = new Map<number, Category>();
    if (cateIds.size > 0) {
      const categories = await this.categoryRepo.find({ where: { id: In([...cateIds]) } });
      categories.forEach((c) => cateMap.set(Number(c.id), c));
    }

    // order 使结果按主键升序，配合下方「后者覆盖前者」的 Map 写入即恒取 id 最大的附件；
    // 此前无 order，取到哪一条取决于存储引擎返回顺序。详情页原先另发一次
    // `order: { id: 'DESC' }` 的查询取同一语义，现改为复用本结果。
    const attachments = await this.attachmentRepo.find({
      where: { type: AttachmentTypeDocument, type_id: In(docIds) },
      order: { id: 'ASC' },
    });
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
          source_url: sanitizeHttpUrl(it.source_url),
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

  async updateDocument(userId: number, canManage: boolean, body: any): Promise<void> {
    const id = Number(body.id);
    if (!id) throw Biz.invalidArgument('文档ID不能为空');
    const exist = await this.docRepo.findOne({ where: { id } });
    if (!exist) throw Biz.notFound('文档不存在');
    if (!canManage && Number(exist.user_id) !== userId) {
      throw Biz.permissionDenied('文档不存在或没有权限');
    }

    const fields: Partial<Document> = {
      title: String(body.title ?? exist.title).slice(0, 255),
      keywords: String(body.keywords ?? exist.keywords),
      description: String(body.description ?? exist.description),
      price: body.price !== undefined ? Number(body.price) : exist.price,
      language: String(body.language ?? exist.language),
      source: String(body.source ?? exist.source),
      source_url: sanitizeHttpUrl(body.source_url ?? exist.source_url),
      updated_at: new Date(),
    };
    if (canManage && body.status !== undefined) {
      fields.status = Number(body.status);
    }

    const categoryIds = positiveNumberArray(body.category_id);

    const queryRunner = this.docRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await this.syncDocumentCategories(queryRunner.manager, id, categoryIds);
      await queryRunner.manager.update(Document, id, fields);
      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  async deleteDocument(userId: number, canDeleteAny: boolean, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    let targetIds = ids;
    if (!canDeleteAny) {
      const docs = await this.docRepo.find({ where: { id: In(ids), user_id: userId }, select: { id: true } } as any);
      targetIds = docs.map((d) => Number(d.id));
      if (targetIds.length === 0) throw Biz.permissionDenied('文档不存在或没有删除权限');
    }

    const queryRunner = this.docRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const docs = await queryRunner.manager.find(Document, {
        where: { id: In(targetIds), deleted_at: IsNull() },
        select: { id: true, user_id: true, deleted_at: true },
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

  async listDocument(params: any, userId: number, canListAll: boolean): Promise<Record<string, any>> {
    let page = Number(params.page) || 1;
    let size = Number(params.size) || 24;
    const limit = Number(params.limit) || 0;
    if (limit > 0) {
      page = 1;
      size = limit;
    }
    if (page < 1) page = 1;
    if (size < 1) size = 24;

    const categoryIds = positiveNumberArray(params.category_id);
    const requestUserIds = positiveNumberArray(params.user_id);
    const requestStatuses = positiveNumberArray(params.status);
    const recommendArr = toBoolArray(params.is_recommend);
    const languages = asArray(params.language)
      .map((l) => String(l).trim())
      .filter(Boolean);

    const queryOwn = requestUserIds.length === 1 && requestUserIds[0] === userId;

    let statuses: number[] = [];
    if (canListAll || queryOwn) {
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
      maskCounts: !canListAll,
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
    const size = this.limitRange(Number(params.size) || 24, 1, 24);
    page = this.limitRange(page, 1, maxPages > 0 ? maxPages : 10000);

    const categoryIds = positiveNumberArray(params.category_id);
    const languages = asArray(params.language)
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

  async getDocumentDetail(params: any, userId: number, canViewAll: boolean): Promise<Record<string, any>> {
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
      !(isOwner || canViewAll)
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
      maskCounts: !canViewAll,
    });
    const item = enriched[0];

    // 复用 enrichDocuments 已查出的附件（其内部已按 id 升序取最后一个，等价于原先此处
    // `order: { id: 'DESC' }` 取最新一条），省掉详情页每次多出的一条查询
    const attachmentHash = (item.attachment as { hash?: string } | null)?.hash || '';
    let content = '';
    if (attachmentHash) {
      const ac = await this.attachmentContentRepo.findOne({ where: { hash: attachmentHash } });
      content = ac?.content || '';
    }
    if (!String(item.description || '').trim() && content) {
      item.description = this.substr(content, 255);
    }
    item.content = params.with_all_content ? content : this.substr(content, 2048 * 4);

    if (withAuthor) {
      // 只取用到的列：此前取整行会把 password 哈希、address、signature、remark 等一并载入
      const user = await this.userRepo.findOne({
        where: { id: uid },
        select: {
          id: true,
          avatar: true,
          realname: true,
          identity: true,
          doc_count: true,
          article_count: true,
          credit_count: true,
        },
      });
      item.user = user
        ? {
            id: Number(user.id),
            avatar: user.avatar,
            realname: user.realname,
            identity: user.identity,
            doc_count: user.doc_count,
            article_count: user.article_count,
            credit_count: user.credit_count,
          }
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
    return this.downloadService.downloadDocument(id, userId, ip, downcode);
  }

  async downloadDocumentToBeReviewed(id: number, userId: number, ip: string): Promise<Record<string, any>> {
    return this.downloadService.downloadDocumentToBeReviewed(id, userId, ip);
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
      // 用数据库当前值原子计算，避免「事务外读 doc.score/score_count、事务内写回」的丢更新：
      // 并发评分时两个请求都会读到同样的旧值，后写的一方会覆盖前者。
      // 公式与原实现一致：newScore = round((score + 旧score × 旧count) / (旧count + 1))。
      await queryRunner.manager
        .createQueryBuilder()
        .update(Document)
        .set({
          score: () => 'ROUND((:newScore + score * score_count) / (score_count + 1))',
          score_count: () => 'score_count + 1',
        })
        .where('id = :id', { id: documentId })
        .setParameter('newScore', score)
        .execute();
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
        await this.syncDocumentCategories(queryRunner.manager, id, categoryIds);
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
    const categoryIds = positiveNumberArray(params.category_id);
    const userIdIds = positiveNumberArray(params.user_id);
    const statuses = positiveNumberArray(params.status);

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
        select: { user_id: true },
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
    // 彻底删除：附件、分类关联、文档本身。
    // 三条 DELETE 必须在同一事务内，否则中途失败会留下「附件已删、文档还在」这类
    // 无法预览的孤儿数据，或「文档已删、分类关联还在」的脏关联。
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Attachment, { type: AttachmentTypeDocument, type_id: In(ids) });
      await manager.delete(DocumentCategory, { document_id: In(ids) });
      await manager.delete(Document, ids);
    });
  }

  async clearRecycleDocument(): Promise<void> {
    // 分批清理：回收站可能积累大量文档，一次性把所有 id 拼进 `IN (...)` 会构造超大 SQL
    // （行数够多时可能超过 max_allowed_packet 而整体失败）。每批 500 条，逐批删除。
    const BATCH = 500;
    for (;;) {
      const docs = await this.docRepo
        .createQueryBuilder('d')
        .select('d.id')
        .where('d.deleted_at IS NOT NULL')
        .orderBy('d.id', 'ASC')
        .limit(BATCH)
        .getMany();
      if (docs.length === 0) return;
      await this.deleteRecycleDocument(docs.map((d) => Number(d.id)));
      if (docs.length < BATCH) return;
    }
  }

  // ================== 查询辅助工具 ==================

  private async attachmentHashMap(docIds: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (docIds.length === 0) return map;
    // order 使结果按主键升序，配合下方「后者覆盖前者」的 Map 写入即恒取 id 最大的附件；
    // 此前无 order，取到哪一条取决于存储引擎返回顺序。详情页原先另发一次
    // `order: { id: 'DESC' }` 的查询取同一语义，现改为复用本结果。
    const attachments = await this.attachmentRepo.find({
      where: { type: AttachmentTypeDocument, type_id: In(docIds) },
      order: { id: 'ASC' },
    });
    attachments.forEach((a) => map.set(Number(a.type_id), a.hash));
    return map;
  }

  private parseCreatedAtRange(v: unknown): [Date, Date] | undefined {
    const arr = asArray(v);
    if (arr.length === 0) return undefined;
    const start = new Date(arr[0]);
    if (isNaN(start.getTime())) return undefined;
    const end = arr.length > 1 ? new Date(arr[1]) : new Date();
    return [start, isNaN(end.getTime()) ? new Date() : end];
  }

}
