import { Repository, MoreThanOrEqual, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Document, Attachment, User, Download, DownloadCode } from '../../../entities';
import { ConfigService } from '../../../config/config.service';
import { Biz } from '../../../common/biz.exception';
import { DocumentStatus, AttachmentTypeDocument } from '../document.constant';

/** 从 document.service.ts 拆分出的下载子服务 */
export class DownloadService {
  constructor(
    private readonly downloadRepo: Repository<Download>,
    private readonly downloadCodeRepo: Repository<DownloadCode>,
    private readonly docRepo: Repository<Document>,
    private readonly attachmentRepo: Repository<Attachment>,
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

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

    const creditName = this.config.getCreditName();
    const price = Number(doc.price);
    const isOwner = Number(doc.user_id) === userId;
    let isPay = price > 0 && !isOwner;

    let needCredit = false;
    if (!isOwner) {
      if (await this.isOwnedDocument(userId, id)) {
        isPay = false;
      } else if (downcode) {
        await this.consumeDownloadCode(downcode, userId, price);
      } else if (price > 0) {
        // 需要扣积分：余额校验与扣减放入下方事务，原子条件扣减杜绝并发超扣
        needCredit = true;
      }
    }

    // 扣积分（如需）、保存下载记录、下载计数自增放在同一事务内。
    // 积分使用条件 UPDATE（credit_count >= price 才扣），并发请求无法同时通过余额校验。
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      if (needCredit) {
        const result = await queryRunner.manager
          .createQueryBuilder()
          .update(User)
          .set({ credit_count: () => `credit_count - ${price}` })
          .where('id = :userId AND credit_count >= :price', { userId, price })
          .execute();
        if ((result.affected || 0) === 0) {
          throw Biz.permissionDenied(`${creditName}不足，无法下载`);
        }
      }

      const down = queryRunner.manager.create(Download, {
        user_id: userId,
        document_id: id,
        ip,
        is_pay: isPay,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await queryRunner.manager.save(down);
      await queryRunner.manager.increment(Document, { id }, 'download_count', 1);

      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }

    return { url: this.generateDownloadURL(doc, attachment.hash, id, userId, ip) };
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

    return { url: this.generateDownloadURL(doc, attachment.hash, id, userId, ip) };
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
      const creditName = this.config.getCreditName();
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

  private generateDownloadURL(doc: Document, hash: string, documentId: number, userId: number, ip: string): string {
    const secretKey = this.config.getDownloadSecret();
    const urlDuration = this.config.getInt('download', 'url_duration', 60);
    const jti = `${userId}.${hash}.${documentId}`;
    // ip 放入 payload 而非 jti：IPv4 含点号，拼进 jti 会破坏 `.` 分隔解析。
    // 下载链接与领取 IP 绑定，转发他人后路由校验 IP 不一致即失效。
    const token = this.jwtService.sign({ ip }, { secret: secretKey, expiresIn: urlDuration, jwtid: jti });
    const filename = encodeURIComponent(String(doc.title) + String(doc.ext || ''));
    return `/download/${token}?user_id=${userId}&document_id=${documentId}&filename=${filename}`;
  }
}