import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '../../config/config.service';
import {
  Attachment,
  Group,
  GroupPermission,
  Permission,
  Punishment,
  User,
  UserGroup,
} from '../../entities';
import { Biz } from '../../common/biz.exception';
import { OssService } from './oss.service';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// 附件类型（web/utils/enum.js attachmentTypeOptions）
const ATTACHMENT_TYPE_NAME: Record<number, string> = {
  0: '未知',
  1: '头像',
  2: '文档',
  3: '文章',
  4: '评论',
  5: '轮播图',
  6: '分类封面',
  7: '配置',
};

// 图片扩展名（util/filetil/filetil.go imagesExt）
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.ico', '.bmp', '.webp']);

// 视频扩展名（文章编辑器资源）
const VIDEO_EXTS = ['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.m4v', '.avi', '.mkv', '.flv', '.wmv'];

// 文章编辑器允许的资源类型：图片 + 视频。刻意排除 .svg/.html 等可执行脚本的同源静态资源。
const ARTICLE_MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);

// 文档扩展名（utils/enum.js word/excel/ppt/pdf/text/other）
const DOCUMENT_EXTS = new Set([
  '.doc', '.docx', '.rtf', '.wps', '.odt',
  '.xls', '.xlsx', '.csv', '.et', '.ods',
  '.ppt', '.pptx', '.pps', '.ppsx', '.dps', '.odp',
  '.pdf', '.txt',
  '.epub', '.umd', '.chm', '.mobi', '.azw', '.azw3', '.azw4',
]);

export interface SavedFile {
  size: number;
  name: string;
  ip: string;
  ext: string;
  enable: boolean;
  hash: string;
  path: string;
  width: number;
  height: number;
}

function getImageSize(buf: Buffer): { width: number; height: number } {
  try {
    if (buf.length < 24) return { width: 0, height: 0 };
    // PNG
    if (buf.readUInt32BE(0) === 0x89504e47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // GIF
    if (buf.toString('ascii', 0, 3) === 'GIF') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    // BMP
    if (buf.toString('ascii', 0, 2) === 'BM') {
      return {
        width: Math.abs(buf.readInt32LE(18)),
        height: Math.abs(buf.readInt32LE(22)),
      };
    }
    // JPEG
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 4 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return { width: 0, height: 0 };
    }
    // WebP
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fmt = buf.toString('ascii', 12, 16);
      if (fmt === 'VP8X') {
        return {
          width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
          height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
        };
      }
      if (fmt === 'VP8 ') {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (fmt === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    // ignore
  }
  return { width: 0, height: 0 };
}

function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

function isDocumentExt(ext: string): boolean {
  return DOCUMENT_EXTS.has(ext.toLowerCase());
}

@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);

  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(UserGroup)
    private readonly userGroupRepo: Repository<UserGroup>,
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(GroupPermission)
    private readonly groupPermissionRepo: Repository<GroupPermission>,
    @InjectRepository(Punishment)
    private readonly punishmentRepo: Repository<Punishment>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly ossService: OssService,
  ) {}

  // ---------- 文件保存 ----------

  /** multer 默认按 latin1 解码 multipart 文件名，中文会乱码，这里转成 utf8。 */
  private decodeOriginalName(name: string): string {
    const buf = Buffer.from(name, 'latin1');
    const utf8 = buf.toString('utf8');
    return utf8.includes('\uFFFD') ? name : utf8;
  }

  /** 校验并保存上传文件，返回附件元数据（不落库）。 */
  async saveFile(file: Express.Multer.File, ip: string, isDocument = false): Promise<SavedFile> {
    const originalName = this.decodeOriginalName(file.originalname);
    const ext = path.extname(originalName).toLowerCase();
    const md5 = crypto.createHash('md5').update(file.buffer).digest('hex');

    const disabled = await this.attachmentRepo.findOne({ where: { hash: md5, enable: false } });
    if (disabled) throw Biz.invalidArgument('文件已被标记为非法文件，禁止上传');

    const dir = isDocument ? 'documents' : 'uploads';
    const relPath = `${dir}/${md5.slice(0, 5).split('').join('/')}/${md5}${ext}`;

    let storedPath: string;
    if (!isDocument && this.ossService.isEnabled()) {
      // OSS 模式：通用附件（图片/头像/文章资源）上传到 OSS，path 存外链。
      try {
        storedPath = await this.ossService.put(relPath, file.buffer, file.mimetype);
      } catch (e) {
        this.logger.warn(`OSS 上传失败，回退本地存储：${(e as Error).message}`);
        storedPath = await this.saveToLocal(relPath, file.buffer);
      }
    } else {
      storedPath = await this.saveToLocal(relPath, file.buffer);
    }

    let width = 0;
    let height = 0;
    if (isImageExt(ext)) {
      const size = getImageSize(file.buffer);
      width = size.width;
      height = size.height;
    }

    return {
      size: file.size,
      name: originalName,
      ip,
      ext,
      enable: true,
      hash: md5,
      path: storedPath,
      width,
      height,
    };
  }

  /** 写入本地磁盘，返回以 / 开头的相对路径。 */
  private saveToLocal(relPath: string, buffer: Buffer): string {
    const absPath = path.resolve(process.cwd(), relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, buffer);
    return '/' + relPath;
  }

  async createAttachment(data: Partial<Attachment>): Promise<Attachment> {
    const entity = this.attachmentRepo.create({
      type: 0,
      type_id: 0,
      enable: true,
      path: '',
      name: '',
      size: 0,
      width: 0,
      height: 0,
      ext: '',
      ip: '',
      ...data,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    } as Attachment);
    return this.attachmentRepo.save(entity);
  }

  /** 校验用户是否在上传文档权限（未被处罚 + 用户组 enable_upload）。 */
  async canAccessUploadDocument(userId: number): Promise<boolean> {
    if (userId === 1) return true;
    if (await this.isInPunishing(userId, [1, 3])) return false;
    const row = await this.groupRepo
      .createQueryBuilder('g')
      .innerJoin(UserGroup, 'ug', 'ug.group_id = g.id')
      .where('ug.user_id = :userId', { userId })
      .andWhere('g.enable_upload = :enable', { enable: true })
      .getOne();
    return !!row;
  }

  /** 用户是否处于启用且未过期的指定处罚类型（1禁用 3禁止上传）中。 */
  async isInPunishing(userId: number, types: number[]): Promise<boolean> {
    if (userId <= 1) return false;
    const row = await this.punishmentRepo
      .createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere('p.enable = :enable', { enable: true })
      .andWhere('p.type IN (:...types)', { types })
      .andWhere('(p.end_time IS NULL OR p.end_time > :now)', { now: new Date() })
      .getOne();
    return !!row;
  }

  /** 根据 HTTP method + path 校验上传权限（与原版 CheckPermissionByUserId 对齐）。 */
  async checkUploadPermission(userId: number, httpPath: string): Promise<boolean> {
    if (userId <= 0) return false;
    if (userId === 1) return true;

    const permission = await this.permissionRepo.findOne({
      where: { method: 'POST', path: httpPath },
    });
    if (!permission) return true;

    const ugs = await this.userGroupRepo.find({ where: { user_id: userId } });
    const groupIds = ugs.map((ug) => ug.group_id).filter((id) => id > 0);
    if (groupIds.length === 0) return false;

    const gp = await this.groupPermissionRepo
      .createQueryBuilder('gp')
      .where('gp.group_id IN (:...groupIds)', { groupIds })
      .andWhere('gp.permission_id = :pid', { pid: permission.id })
      .getOne();
    return !!gp;
  }

  // ---------- 上传 ----------

  /** 上传文档：校验扩展名，保存文件并落库，返回附件 id。 */
  async uploadDocument(file: Express.Multer.File, ip: string, userId: number): Promise<{ id: number }> {
    if (!file) throw Biz.invalidArgument('缺少上传文件');
    const ext = path.extname(file.originalname).toLowerCase();
    if (!isDocumentExt(ext)) throw Biz.invalidArgument('不支持的文档类型');

    const allowedRaw = this.configService.get('security', 'document_allowed_ext', '');
    const allowed = allowedRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(ext)) throw Biz.invalidArgument('不支持的文档类型');

    const maxSizeMb = this.configService.getInt('security', 'max_document_size', 50);
    if (file.size > maxSizeMb * 1024 * 1024) {
      throw Biz.invalidArgument(`文档大小不能超过 ${maxSizeMb}MB`);
    }

    if (!(await this.canAccessUploadDocument(userId))) {
      throw Biz.permissionDenied('没有权限上传文档');
    }

    const saved = await this.saveFile(file, ip, true);
    const attachment = await this.createAttachment({ user_id: userId, type: 2, ...saved });
    return { id: attachment.id };
  }

  /** 上传图片：头像/配置/轮播图/分类封面。头像会更新用户头像并软删旧头像附件。 */
  async uploadImage(file: Express.Multer.File, ip: string, userId: number, type: number): Promise<Record<string, unknown>> {
    if (!file) throw Biz.invalidArgument('缺少上传文件');
    const ext = path.extname(file.originalname).toLowerCase();
    if (!isImageExt(ext)) {
      throw Biz.invalidArgument('请上传图片格式文件，支持.jpg、.jpeg、.png、.gif、.webp、.bmp和.ico格式图片');
    }

    const saved = await this.saveFile(file, ip);

    if (type === 1) {
      await this.userRepo.update({ id: userId }, { avatar: saved.path, updated_at: new Date() });
      await this.attachmentRepo
        .createQueryBuilder()
        .update(Attachment)
        .set({ deleted_at: new Date(), updated_at: new Date() })
        .where('type = :type AND type_id = :typeId', { type: 1, typeId: userId })
        .execute();
    }

    const attachment = await this.createAttachment({
      user_id: userId,
      type,
      type_id: type === 1 ? userId : 0,
      ...saved,
    });
    return this.serialize(attachment);
  }

  /** 上传文章编辑器资源（图片/视频），返回 wangeditor 结构。 */
  async uploadArticle(file: Express.Multer.File, ip: string, userId: number): Promise<{ errno: number; msg?: string; data?: { url: string; alt?: string } }> {
    if (!file) return { errno: 1, msg: '缺少上传文件' };
    // 编辑器资源会以静态文件形式同源访问，必须限定为媒体类型：
    // 否则上传 .html/.svg 可直接获得同源脚本执行能力（存储型 XSS）。
    const ext = path.extname(this.decodeOriginalName(file.originalname)).toLowerCase();
    if (!ARTICLE_MEDIA_EXTS.has(ext)) {
      return { errno: 1, msg: '仅支持上传图片或视频文件' };
    }
    const saved = await this.saveFile(file, ip);
    const attachment = await this.createAttachment({ user_id: userId, type: 3, ...saved });
    return { errno: 0, data: { url: attachment.path, alt: attachment.name } };
  }

  // ---------- Attachment 管理 ----------

  private serialize(a: Attachment): Record<string, unknown> {
    return {
      id: a.id,
      hash: a.hash,
      user_id: a.user_id,
      type_id: a.type_id,
      type: a.type,
      enable: a.enable,
      path: a.path,
      name: a.name,
      size: a.size,
      width: a.width,
      height: a.height,
      ext: a.ext,
      ip: a.ip,
      realname: (a as any).realname ?? '',
      type_name: ATTACHMENT_TYPE_NAME[a.type] ?? '',
      description: a.description,
      created_at: a.created_at,
      updated_at: a.updated_at,
    };
  }

  async updateAttachment(id: number, name: string, enable: boolean, description: string): Promise<void> {
    await this.attachmentRepo.update(
      { id },
      { name: name ?? '', enable: enable ?? true, description: description ?? '', updated_at: new Date() },
    );
  }

  async deleteAttachment(ids: number[]): Promise<void> {
    if (!ids.length) return;
    await this.attachmentRepo.update(
      { id: ids as any },
      { deleted_at: new Date(), updated_at: new Date() },
    );
  }

  async getAttachment(id: number): Promise<Record<string, unknown>> {
    const a = await this.attachmentRepo.findOne({ where: { id, deleted_at: null } });
    if (!a) throw Biz.notFound('附件不存在');
    return this.serialize(a);
  }

  async listAttachment(query: Record<string, any>): Promise<{ total: number; attachment: Record<string, unknown>[] }> {
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.max(1, Number(query.size) || 10);

    const qb = this.attachmentRepo.createQueryBuilder('a').where('a.deleted_at IS NULL');

    const wd = String(query.wd ?? '').trim();
    if (wd) qb.andWhere('(a.name LIKE :wd OR a.description LIKE :wd)', { wd: `%${wd}%` });

    const userIds = toNumberArray(query.user_id);
    if (userIds.length) qb.andWhere('a.user_id IN (:...userIds)', { userIds });

    const enables = toBoolArray(query.enable);
    if (enables.length) qb.andWhere('a.enable IN (:...enables)', { enables });

    const types = toNumberArray(query.type);
    if (types.length) qb.andWhere('a.type IN (:...types)', { types });

    const ext = String(query.ext ?? '').trim();
    if (ext) qb.andWhere('a.ext = :ext', { ext });

    const total = await qb.getCount();
    const list = await qb
      .orderBy('a.id', 'DESC')
      .offset((page - 1) * size)
      .limit(size)
      .getMany();

    const idSet = [...new Set(list.map((a) => a.user_id).filter((id) => id > 0))];
    const users = idSet.length ? await this.userRepo.find({ where: { id: idSet as any } }) : [];
    const nameMap = new Map(users.map((u) => [u.id, u.realname || u.email]));

    const attachment = list.map((a) => {
      (a as any).realname = nameMap.get(a.user_id) ?? '';
      return this.serialize(a);
    });

    return { total, attachment };
  }

  // ---------- 文件预览 / 下载 / favicon ----------

  resolveDocumentPath(segments: string[]): string {
    return path.resolve(process.cwd(), 'documents', ...segments);
  }

  /** 预览页资源绝对路径：documents/{h/a/s/h}/{hash}/{page}。 */
  resolvePagePath(hash: string, page: string): string {
    return path.resolve(process.cwd(), 'documents', ...hash.slice(0, 5).split(''), hash, page);
  }

  /** 文档封面绝对路径：documents/{h/a/s/h}/{hash}/cover.png。 */
  resolveCoverPath(hash: string): string {
    return path.resolve(process.cwd(), 'documents', ...hash.slice(0, 5).split(''), hash, 'cover.png');
  }

  /** 原始文档绝对路径：documents/{h/a/s/h}/{hash}{extname(filename)}。 */
  resolveDownloadPath(hash: string, filename: string): string {
    // filename 来自下载 URL 的 query，可被篡改，必须取 basename 后再取扩展名，
    // 否则 `a.x/../../../etc/passwd` 这类值会逃出 documents 目录。
    const ext = path.extname(path.basename(filename));
    return path.resolve(process.cwd(), 'documents', ...hash.slice(0, 5).split(''), `${hash}${ext}`);
  }

  async verifyDownloadToken(token: string): Promise<{ userId: string; hash: string; documentId: string; ip: string }> {
    const secret = this.configService.getDownloadSecret();
    let payload: Record<string, any>;
    try {
      payload = this.jwtService.verify<Record<string, any>>(token, { secret });
    } catch {
      throw Biz.invalidArgument('下载链接已失效');
    }
    const id = String(payload.jti ?? '');
    const parts = id.split('.');
    if (parts.length !== 3) throw Biz.invalidArgument('下载链接已失效');
    return { userId: parts[0], hash: parts[1], documentId: parts[2], ip: String(payload.ip ?? '') };
  }

  faviconPath(): string {
    const configured = String(this.configService.get('system', 'favicon', '')).replace(/^(\.\.?\/)+/, '');
    if (configured) {
      const abs = path.resolve(process.cwd(), configured);
      if (fs.existsSync(abs)) return abs;
    }
    return path.resolve(process.cwd(), 'favicon.ico');
  }
}

function toNumberArray(v: unknown): number[] {
  if (!Array.isArray(v)) {
    if (v === undefined || v === null || v === '') return [];
    return [Number(v)].filter((n) => !Number.isNaN(n));
  }
  return v.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
}

function toBoolArray(v: unknown): boolean[] {
  if (!Array.isArray(v)) {
    if (v === undefined || v === null || v === '') return [];
    return [v === true || v === 'true' || v === 1 || v === '1'];
  }
  return v.map((x) => x === true || x === 'true' || x === 1 || x === '1');
}