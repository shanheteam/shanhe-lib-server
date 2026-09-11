import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AttachmentService } from './attachment.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * 文档预览 / 下载 / favicon 文件路由（不挂载 api/v1 前缀）。
 * 与原版 gin 原生路由 /view/*、/download/:jwt、/favicon.ico 保持一致。
 */
@Controller()
export class FileController {
  constructor(private readonly service: AttachmentService) {}

  @Public()
  @Get('view/page/:hash/:page')
  viewPage(
    @Param('hash') hash: string,
    @Param('page') page: string,
    @Res() res: Response,
  ) {
    if (!hash || hash.length !== 32) {
      return res.status(404).json({ code: 400, message: 'hash值必须32位' });
    }
    const safePage = (page || '').replace(/^[./]+/, '');
    if (safePage.endsWith('.svg')) {
      if (safePage.endsWith('.gzip.svg')) res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'image/svg+xml');
    }
    return res.sendFile(this.service.resolvePagePath(hash, safePage));
  }

  @Public()
  @Get('view/cover/:hash')
  viewCover(@Param('hash') hash: string, @Res() res: Response) {
    if (!hash || hash.length !== 32) {
      return res.status(404).json({ code: 400, message: 'hash值必须32位' });
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
    const file = this.service.resolveDownloadPath(claims.hash, filename);
    return res.download(file, filename);
  }

  @Public()
  @Get('favicon.ico')
  favicon(@Res() res: Response) {
    return res.sendFile(this.service.faviconPath());
  }
}