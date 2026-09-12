import { Injectable, Logger } from '@nestjs/common';
import OSS from 'ali-oss';
import { ConfigService } from '../../config/config.service';

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
 * 注意：文档原文件上传不走 OSS（文档转换依赖本地 LibreOffice），因此该方法只接收
 * 通用文件（非文档）。
 */
@Injectable()
export class OssService {
  private readonly logger = new Logger(OssService.name);

  constructor(private readonly config: ConfigService) {}

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

  /** 构造对象外链地址。 */
  private buildUrl(remoteKey: string): string {
    const region = this.region().replace(/^https?:\/\//, '').replace(/\.aliyuncs\.com$/, '');
    const host = this.domain() || `${this.bucket()}.${region}.aliyuncs.com`;
    return `https://${host}/${remoteKey}`;
  }

  /**
   * 上传 buffer 到 OSS，返回可访问外链。
   * @param remoteKey 对象键（相对路径）
   * @param buffer    文件内容
   * @param contentType 对象 Content-Type
   */
  async put(remoteKey: string, buffer: Buffer, contentType: string): Promise<string> {
    const res = await this.client().put(remoteKey, buffer, {
      headers: { 'Content-Type': contentType },
    });
    if (!res || !res.url) {
      throw new Error(`OSS 上传失败：${remoteKey}`);
    }
    // 若 SDK 返回的是临时签名域名的完整 URL，统一换成本服务生成的外链，保证可长时间访问。
    return this.buildUrl(remoteKey);
  }
}