import { Controller, Get, Logger, Param, Query, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import * as path from 'path';
import { AttachmentService } from './attachment.service';
import { OssService, contentTypeOf } from './oss.service';
import { Public } from '../../common/decorators/public.decorator';

/** 构造 Content-Disposition 响应头（RFC 5987），保留中文文件名。 */
function buildContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** 附件 hash 为 md5 十六进制，限定格式可避免其被当作路径片段穿越目录。 */
function isValidHash(hash: string): boolean {
  return /^[0-9a-f]{32}$/i.test(hash);
}

/**
 * 文档预览 / 下载 / favicon 文件路由（不挂载 api/v1 前缀）。
 * 与原版 gin 原生路由 /view/*、/download/:jwt、/favicon.ico 保持一致。
 * OSS 启用时：预览/封面/下载「OSS 优先、本地兜底」。
 */
@Controller()
@SkipThrottle()
export class FileController {
  private readonly logger = new Logger(FileController.name);

  constructor(
    private readonly service: AttachmentService,
    private readonly ossService: OssService,
  ) {}

  @Public()
  @Get('view/page/:hash/:page')
  async viewPage(
    @Param('hash') hash: string,
    @Param('page') page: string,
    @Res() res: Response,
  ) {
    if (!isValidHash(hash)) {
      return res.status(404).json({ code: 400, message: 'hash值必须32位' });
    }
    // page 为路由参数，但 %2F 会在匹配后被解码，必须彻底拒绝路径分隔符与上跳，
    // 否则可借助 `a%2f..%2f..%2fetc%2fpasswd` 读取 documents 目录之外的文件。
    const safePage = (page || '').replace(/^[./]+/, '');
    if (!safePage || safePage.includes('..') || /[\\/]/.test(safePage)) {
      return res.status(404).json({ code: 400, message: 'page参数不合法' });
    }
    const isGzip = safePage.endsWith('.gzip.svg');
    const contentType = safePage.endsWith('.svg')
      ? 'image/svg+xml'
      : contentTypeOf(path.extname(safePage));

    if (this.ossService.isEnabled()) {
      try {
        const key = OssService.pageKey(hash, safePage);
        if (await this.ossService.exists(key)) {
          // 预览页已上传 OSS：302 重定向到自定义域名外链，浏览器直接从 CDN/OSS 加载
          return res.redirect(302, this.ossService.buildUrl(key));
        }
      } catch (e) {
        this.logger.warn(`OSS 预览读取失败，回退本地：${(e as Error).message}`);
      }
    }

    if (isGzip) res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Type', contentType);
    return res.sendFile(this.service.resolvePagePath(hash, safePage));
  }

  @Public()
  @Get('view/cover/:hash')
  async viewCover(@Param('hash') hash: string, @Res() res: Response) {
    if (!isValidHash(hash)) {
      return res.status(404).json({ code: 400, message: 'hash值必须32位' });
    }

    if (this.ossService.isEnabled()) {
      try {
        const key = OssService.coverKey(hash);
        if (await this.ossService.exists(key)) {
          // 封面已上传 OSS：302 重定向到自定义域名外链
          return res.redirect(302, this.ossService.buildUrl(key));
        }
      } catch (e) {
        this.logger.warn(`OSS 封面读取失败，回退本地：${(e as Error).message}`);
      }
    }

    return res.sendFile(this.service.resolveCoverPath(hash));
  }

  @Public()
  @Get('download/:jwt')
  async download(
    @Param('jwt') jwt: string,
    @Query() query: Record<string, any>,
    @Res() res: Response,
  ) {
    let claims: { userId: string; hash: string; documentId: string };
    try {
      claims = await this.service.verifyDownloadToken(jwt);
    } catch {
      return res.status(400).send('下载链接已失效');
    }
    const userId = String(query.user_id ?? '');
    const documentId = String(query.document_id ?? '');
    if (claims.userId !== userId || claims.documentId !== documentId) {
      return res.status(400).send('下载链接已失效');
    }
    const filename = String(query.filename ?? '');

    if (this.ossService.isEnabled()) {
      try {
        const key = OssService.documentKey(claims.hash, path.extname(filename));
        if (await this.ossService.exists(key)) {
          const url = await this.ossService.signedUrl(key, {
            expires: 60,
            responseContentDisposition: buildContentDisposition(filename),
          });
          return res.redirect(302, url);
        }
      } catch (e) {
        this.logger.warn(`OSS 下载准备失败，回退本地：${(e as Error).message}`);
      }
    }

    const file = this.service.resolveDownloadPath(claims.hash, filename);
    return res.download(file, filename);
  }

  @Public()
  @Get('favicon.ico')
  favicon(@Res() res: Response) {
    return res.sendFile(this.service.faviconPath());
  }
}
