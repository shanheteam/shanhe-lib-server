import { Injectable, Logger } from '@nestjs/common';
import OSS from 'ali-oss';
import { ConfigService } from '../../config/config.service';

/** 常见文档/图片扩展名 → Content-Type。 */
export function contentTypeOf(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pps': 'application/vnd.ms-powerpoint',
    '.ppsx': 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    '.pot': 'application/vnd.ms-powerpoint',
    '.txt': 'text/plain',
    '.rtf': 'application/rtf',
    '.csv': 'text/csv',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.epub': 'application/epub+zip',
    '.mobi': 'application/x-mobipocket-ebook',
    '.azw': 'application/vnd.amazon.ebook',
    '.azw3': 'application/vnd.amazon.ebook',
    '.azw4': 'application/vnd.amazon.ebook',
    '.chm': 'application/vnd.ms-htmlhelp',
    '.umd': 'application/octet-stream',
    '.odt': 'application/vnd.oasis.opendocument.text',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.odp': 'application/vnd.oasis.opendocument.presentation',
    '.wps': 'application/vnd.ms-works',
    '.et': 'application/octet-stream',
    '.dps': 'application/octet-stream',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * 阿里云 OSS 存储服务。
 *
 * 配置项（config 表 category = storage）：
 *   - enable_oss           是否启用 OSS（启用后通用附件：图片/头像/文章资源走 OSS）
 *   - oss_region           区域，如 oss-cn-hangzhou
 *   - oss_bucket           Bucket 名称
 *   - oss_access_key_id    AccessKey ID
 *   - oss_access_key_secret AccessKey Secret
 *   - oss_domain           可选，自定义访问域名（如 CDN 域名），留空则用 {bucket}.{region}.aliyuncs.com
 *
 * 注意：文档原文件需先本地转换（依赖 LibreOffice），转换完成后由转换 worker
 * 将原文件 + 预览页 + 封面一并上传到 OSS。
 */
@Injectable()
export class OssService {
  private readonly logger = new Logger(OssService.name);

  constructor(private readonly config: ConfigService) {}

  // ---------- OSS key 推导（与本地 documents/ 相对路径一一对应，只依赖 hash + ext） ----------

  /** 文档原文件 key：documents/{h0}/{h1}/{h2}/{h3}/{h4}/{hash}{ext} */
  static documentKey(hash: string, ext: string): string {
    const dirs = hash.slice(0, 5).split('').join('/');
    return `documents/${dirs}/${hash}${ext}`;
  }

  /** 预览页 key：documents/{h0}/.../{hash}/{page}，page 如 1.webp / 1.gzip.svg */
  static pageKey(hash: string, page: string): string {
    const dirs = hash.slice(0, 5).split('').join('/');
    return `documents/${dirs}/${hash}/${page}`;
  }

  /** 封面 key：documents/{h0}/.../{hash}/cover.png */
  static coverKey(hash: string): string {
    const dirs = hash.slice(0, 5).split('').join('/');
    return `documents/${dirs}/${hash}/cover.png`;
  }

  /** 是否启用 OSS 且配置完整。 */
  isEnabled(): boolean {
    if (!this.config.getBool('storage', 'enable_oss', false)) return false;
    return !!(this.region() && this.bucket() && this.accessKeyId() && this.accessKeySecret());
  }

  private region(): string {
    return this.config.get('storage', 'oss_region', '').trim();
  }

  private bucket(): string {
    return this.config.get('storage', 'oss_bucket', '').trim();
  }

  private accessKeyId(): string {
    return this.config.get('storage', 'oss_access_key_id', '').trim();
  }

  private accessKeySecret(): string {
    return this.config.get('storage', 'oss_access_key_secret', '').trim();
  }

  private domain(): string {
    return this.config.get('storage', 'oss_domain', '').trim();
  }

  private client(): OSS {
    return new OSS({
      region: this.region(),
      bucket: this.bucket(),
      accessKeyId: this.accessKeyId(),
      accessKeySecret: this.accessKeySecret(),
      secure: true,
    });
  }

  /** 构造对象外链地址（优先使用自定义域名 oss_domain，自动规范化域名格式）。 */
  buildUrl(remoteKey: string): string {
    const region = this.region().replace(/^https?:\/\//, '').replace(/\.aliyuncs\.com$/, '');
    const host = (this.domain() || `${this.bucket()}.${region}.aliyuncs.com`)
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    return `https://${host}/${remoteKey.replace(/^\/+/, '')}`;
  }

  /**
   * 上传 buffer 到 OSS，返回可访问外链。
   * @param remoteKey 对象键（相对路径）
   * @param buffer    文件内容
   * @param contentType 对象 Content-Type
   * @param options.contentEncoding 可选，写入对象元数据（如 .gzip.svg → 'gzip'）
   */
  async put(
    remoteKey: string,
    buffer: Buffer,
    contentType: string,
    options: { contentEncoding?: string } = {},
  ): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (options.contentEncoding) headers['Content-Encoding'] = options.contentEncoding;
    const res = await this.client().put(remoteKey, buffer, { headers });
    if (!res || !res.url) {
      throw new Error(`OSS 上传失败：${remoteKey}`);
    }
    // 若 SDK 返回的是临时签名域名的完整 URL，统一换成本服务生成的外链，保证可长时间访问。
    return this.buildUrl(remoteKey);
  }

  /** 对象是否存在。404/NoSuchKey 返回 false；403/网络等错误向上抛，由调用方回退本地。 */
  async exists(remoteKey: string): Promise<boolean> {
    try {
      await this.client().head(remoteKey);
      return true;
    } catch (e: any) {
      if (e && (e.status === 404 || e.code === 'NoSuchKey' || e.name === 'NoSuchKeyError')) {
        return false;
      }
      throw e;
    }
  }

  /** 读取对象内容为 Buffer。 */
  async get(remoteKey: string): Promise<Buffer> {
    const res = await this.client().get(remoteKey);
    if (!res || res.content == null) {
      throw new Error(`OSS 读取失败：${remoteKey}`);
    }
    return Buffer.isBuffer(res.content) ? res.content : Buffer.from(res.content);
  }

  /**
   * 生成签名下载 URL。
   * 配置了自定义域名（oss_domain）时，将默认 OSS 端点 host 替换为自定义域名；
   * OSS 签名校验的 StringToSign 不含 host，替换后签名仍然有效，浏览器经 CDN/自定义域名访问。
   * @param opts.responseContentDisposition 可选，控制下载时响应头（保留原始文件名，RFC 5987）
   */
  async signedUrl(
    remoteKey: string,
    opts: { expires?: number; responseContentDisposition?: string } = {},
  ): Promise<string> {
    const options: OSS.SignatureUrlOptions = { expires: opts.expires ?? 60 };
    if (opts.responseContentDisposition) {
      options.response = { 'content-disposition': opts.responseContentDisposition };
    }
    const url = await this.client().signatureUrl(remoteKey, options);
    const domain = this.domain();
    if (!domain) return url;
    return url.replace(
      /^https?:\/\/[^/?#]+/,
      `https://${domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`,
    );
  }
}
