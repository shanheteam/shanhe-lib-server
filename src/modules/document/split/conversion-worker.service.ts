import { Logger } from '@nestjs/common';
import { Repository, In } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { v1 as uuidV1 } from 'uuid';
import { Document, Attachment, DocumentError } from '../../../entities';
import { ConfigService } from '../../../config/config.service';
import { ConverterService } from '../../converter/converter.service';
import { OssService, contentTypeOf } from '../../attachment/oss.service';
import { DocumentStatus, AttachmentTypeDocument } from '../document.constant';

/** 每 tick 扫描间隔（毫秒） */
const TICK_INTERVAL_MS = 5000;
/** 存量迁移空转退避上限（毫秒） */
const MIGRATE_BACKOFF_MAX_MS = 5 * 60 * 1000;

/**
 * 后台文档转换 worker：每 tick 处理一个待转换文档，无任务时按退避节奏迁移存量本地文档到 OSS。
 * 由 DocumentService 持有，onModuleInit 启动定时器调用 tick()。
 */
export class ConversionWorkerService {
  private readonly logger = new Logger(ConversionWorkerService.name);
  private converting = false;
  /**
   * 存量迁移扫描的空转退避状态（见迁移查询注释，退避只延后扫描、绝不跳过待迁移文件）。
   */
  private migrateIdleStreak = 0;
  private migrateNextScanAt = 0;

  constructor(
    private readonly docRepo: Repository<Document>,
    private readonly attachmentRepo: Repository<Attachment>,
    private readonly docErrorRepo: Repository<DocumentError>,
    private readonly config: ConfigService,
    private readonly converter: ConverterService,
    private readonly ossService: OssService,
    private readonly loggerService?: Logger,
  ) {}

  private get log(): Logger {
    return this.loggerService ?? this.logger;
  }

  async tick(): Promise<void> {
    if (this.converting) return;
    this.converting = true;
    try {
      // 优先处理待转换文档；无待转换任务时，尝试迁移存量本地文档到 OSS
      if (!(await this.convertNextDocument())) {
        await this.maybeMigrateNextDocument();
      }
    } catch (e) {
      this.log.error(`转换 worker 异常：${(e as Error).message}`);
    } finally {
      this.converting = false;
    }
  }

  /** 按空转退避节奏执行存量迁移扫描：有进展立即恢复每 tick 扫描，连续空扫则逐步拉长间隔。 */
  private async maybeMigrateNextDocument(): Promise<void> {
    if (Date.now() < this.migrateNextScanAt) return;
    const migrated = await this.migrateNextDocument();
    if (migrated) {
      this.migrateIdleStreak = 0;
      this.migrateNextScanAt = 0;
      return;
    }
    this.migrateIdleStreak = Math.min(this.migrateIdleStreak + 1, 10);
    const backoff = Math.min(
      TICK_INTERVAL_MS * 2 ** this.migrateIdleStreak,
      MIGRATE_BACKOFF_MAX_MS,
    );
    this.migrateNextScanAt = Date.now() + backoff;
  }

  private async convertNextDocument(): Promise<boolean> {
    // 原先写作 `status IN (0,5) ORDER BY id ASC LIMIT 1`：队列为空时 MySQL 常常选择
    // 沿主键顺序扫描并逐行过滤 status（避免 filesort），退化为全表级扫描，而它每 5 秒跑一次。
    // 现拆成两次「单一 status + ORDER BY id」的查询，各自都能用 idx_status_id 直接取有序首行，
    // 再取两者中 id 较小者 —— 与原语义（全局最早的一条）完全一致。
    //
    // 刻意**不**给这条路径加退避：转换是上传后用户可见的流程，
    // 若照搬存量迁移那套最长 5 分钟的退避，用户上传后要等数分钟才会开始转换。
    const [pending, rePending] = await Promise.all([
      this.docRepo.findOne({
        where: { status: DocumentStatus.Pending },
        order: { id: 'ASC' },
        select: { id: true },
      }),
      this.docRepo.findOne({
        where: { status: DocumentStatus.RePending },
        order: { id: 'ASC' },
        select: { id: true },
      }),
    ]);

    const candidates = [pending?.id, rePending?.id]
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (candidates.length === 0) return false;

    const doc = await this.docRepo.findOne({ where: { id: Math.min(...candidates) } });
    if (!doc) return false;
    await this.handleDocument(doc);
    return true;
  }

  /** 迁移一篇存量本地文档到 OSS。返回「本次是否真正处理了文件」。 */
  private async migrateNextDocument(): Promise<boolean> {
    if (!this.ossService.isEnabled()) return false;
    const attachment = await this.attachmentRepo
      .createQueryBuilder('a')
      .innerJoin(Document, 'd', 'd.id = a.type_id')
      .where('a.type = :type', { type: AttachmentTypeDocument })
      .andWhere('a.path NOT LIKE :http', { http: 'http%' })
      .andWhere('d.status = :status', { status: DocumentStatus.Converted })
      .andWhere('d.deleted_at IS NULL')
      .orderBy('a.id', 'ASC')
      .take(1)
      .getOne();
    if (!attachment) return false;

    const hash = String(attachment.hash || '');
    const ext = String(attachment.ext || '').toLowerCase();
    const relPath = String(attachment.path || '').replace(/^\/+/, '');
    if (!hash || !relPath) {
      this.log.warn(`存量迁移跳过（attachment_id=${attachment.id}）：附件路径或 hash 无效`);
      return false;
    }
    const srcPath = path.resolve(process.cwd(), relPath);
    if (!fs.existsSync(srcPath)) {
      this.log.warn(`存量迁移跳过（attachment_id=${attachment.id}）：本地原文件不存在`);
      return false;
    }
    const srcExt = path.extname(srcPath);
    const baseDir = srcPath.slice(0, srcPath.length - srcExt.length);
    await this.uploadDocumentFilesToOss(attachment, srcPath, baseDir);
    return true;
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

    const hash = String(attachment.hash || '');
    const ext = String(attachment.ext || '').toLowerCase();
    const ossEnabled = this.ossService.isEnabled();
    const workspace = this.makeWorkspace();

    // 定位本地原文件；若本地缺失（如 OSS 上传后本地已清理、再次重新转换），从 OSS 下载到工作区
    const relPath = String(attachment.path || '').replace(/^\/+/, '');
    const srcPath = path.resolve(process.cwd(), relPath);
    let localSrc = srcPath;
    if (!relPath || !fs.existsSync(srcPath)) {
      if (!ossEnabled || !hash) {
        await this.docRepo.update(documentId, { status: DocumentStatus.Failed });
        await this.setConvertError(documentId, new Error('文档原文件不存在'));
        return;
      }
      try {
        const buf = await this.ossService.get(OssService.documentKey(hash, ext));
        localSrc = path.join(workspace, `${hash}${ext}`);
        fs.writeFileSync(localSrc, buf);
      } catch (e) {
        await this.docRepo.update(documentId, { status: DocumentStatus.Failed });
        await this.setConvertError(documentId, new Error(`从 OSS 下载原文件失败：${(e as Error).message}`));
        return;
      }
    }

    const srcExt = path.extname(localSrc);
    const baseDir = localSrc.slice(0, localSrc.length - srcExt.length);
    const coverPath = path.join(baseDir, 'cover.png');
    fs.mkdirSync(baseDir, { recursive: true });

    const cfgExtension = (this.config.get('converter', 'extension', 'webp') || 'webp').toLowerCase();
    const cfgEnableGzip = this.config.getBool('converter', 'enable_gzip', true);
    const cfgMaxPreview = this.config.getInt('converter', 'max_preview', 0);
    const cfgMaxPercent = this.config.getInt('converter', 'max_preview_percent', 100);

    try {
      const dstPDF = await this.converter.convertToPDF(localSrc, workspace);
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

      const ext2 = `.${cfgExtension}`;
      const pageList = await this.converter.convertPDFToPages(dstPDF, workspace, 1, toPage, ext2);
      if (!pageList || pageList.length === 0) throw new Error('文档预览页转换失败');

      const isSvg = cfgExtension === 'svg';
      const gzipExt = isSvg && cfgEnableGzip;
      const finalExt = gzipExt ? '.gzip.svg' : ext2;

      // 生成封面（取第一页）
      if (pageList.length > 0) {
        try {
          await this.converter.generateCover(pageList[0].page_path, coverPath);
        } catch (e) {
          this.log.warn(`生成封面失败：${(e as Error).message}`);
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

      // 转换成功后：原文件 + 预览页 + 封面上传 OSS，成功后清理本地；失败自动回退本地
      if (ossEnabled && hash) {
        await this.uploadDocumentFilesToOss(attachment, localSrc, baseDir);
      }

      await this.docRepo.update(documentId, {
        pages,
        preview,
        status: DocumentStatus.Converted,
        enable_gzip: gzipExt,
        preview_ext: isSvg ? '.svg' : ext2,
        updated_at: new Date(),
      });
      await this.clearConvertError(documentId);
    } catch (e) {
      this.log.error(`文档转换失败（id=${documentId}）：${(e as Error).message}`);
      await this.docRepo.update(documentId, { status: DocumentStatus.Failed });
      await this.setConvertError(documentId, e as Error);
    } finally {
      this.cleanup(workspace);
    }
  }

  /**
   * 将文档本地文件（原文件 + 预览页 + 封面）上传到 OSS。
   * 全部成功后：更新附件 path 为 OSS 外链，再清理本地文件；任一失败则保留本地（自动回退）。
   */
  private async uploadDocumentFilesToOss(
    attachment: Attachment,
    srcPath: string,
    baseDir: string,
  ): Promise<void> {
    const hash = String(attachment.hash || '');
    const ext = String(attachment.ext || '').toLowerCase();
    if (!hash) return;

    const coverPath = path.join(baseDir, 'cover.png');
    const uploads: Array<{
      key: string;
      file: string;
      contentType: string;
      contentEncoding?: string;
    }> = [];

    if (fs.existsSync(srcPath)) {
      uploads.push({
        key: OssService.documentKey(hash, ext),
        file: srcPath,
        contentType: contentTypeOf(ext),
      });
    }
    if (fs.existsSync(baseDir)) {
      for (const f of fs.readdirSync(baseDir)) {
        const abs = path.join(baseDir, f);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(abs);
        } catch {
          continue;
        }
        if (!stat.isFile() || f.toLowerCase() === 'cover.png') continue;
        const lower = f.toLowerCase();
        const gzip = lower.endsWith('.gzip.svg');
        uploads.push({
          key: OssService.pageKey(hash, f),
          file: abs,
          contentType: gzip ? 'image/svg+xml' : contentTypeOf(path.extname(f)),
          contentEncoding: gzip ? 'gzip' : undefined,
        });
      }
    }
    if (fs.existsSync(coverPath)) {
      uploads.push({ key: OssService.coverKey(hash), file: coverPath, contentType: 'image/png' });
    }
    if (uploads.length === 0) return;

    try {
      for (const u of uploads) {
        await this.ossService.put(
          u.key,
          fs.readFileSync(u.file),
          u.contentType,
          u.contentEncoding ? { contentEncoding: u.contentEncoding } : {},
        );
      }
      // 全部成功：先更新附件外链，再清理本地文件
      await this.attachmentRepo.update(attachment.id, {
        path: this.ossService.buildUrl(OssService.documentKey(hash, ext)),
        updated_at: new Date(),
      });
      const documentsAbs = path.resolve(process.cwd(), 'documents');
      try {
        if (fs.existsSync(srcPath)) fs.unlinkSync(srcPath);
        if (baseDir.startsWith(documentsAbs)) fs.rmSync(baseDir, { recursive: true, force: true });
      } catch (e) {
        this.log.warn(`清理本地文件失败：${(e as Error).message}`);
      }
      this.log.log(`文档附件已上传 OSS（attachment_id=${attachment.id}, hash=${hash.slice(0, 8)}…）`);
    } catch (e) {
      this.log.warn(`文档 OSS 上传失败，回退本地存储（attachment_id=${attachment.id}）：${(e as Error).message}`);
    }
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
      this.log.warn(`清理临时目录失败：${(e as Error).message}`);
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
}