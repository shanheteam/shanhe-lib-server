import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';

const SOFFICE = process.env.SOFFICE_BIN || 'soffice';
const EBOOK_CONVERT = process.env.EBOOK_CONVERT_BIN || 'ebook-convert';
const MUTOOL = process.env.MUTOOL_BIN || 'mutool';
const SVGO = process.env.SVGO_BIN || 'svgo';
const INKSCAPE = process.env.INKSCAPE_BIN || 'inkscape';
const IMAGE_MAGICK = process.env.IMAGE_MAGICK_BIN || 'convert';

export interface ConvertPage {
  page_num: number;
  page_path: string;
}

/**
 * 文档转换服务：调用外部工具（soffice / ebook-convert / mutool / inkscape），
 * 行为与原版 util/converter/converter.go 保持一致。
 */
@Injectable()
export class ConverterService {
  private readonly logger = new Logger(ConverterService.name);
  private readonly timeout = Number(process.env.CONVERT_TIMEOUT || 3600 * 1000) * 1; // 默认 1 小时（毫秒）

  private run(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      this.logger.debug(`exec: ${cmd} ${args.join(' ')}`);
      execFile(cmd, args, { timeout: this.timeout, maxBuffer: 1024 * 1024 * 32 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
          return;
        }
        resolve(stdout || '');
      });
    });
  }

  private has(p: string): boolean {
    return fs.existsSync(p);
  }

  /** 二进制可执行文件是否存在 */
  private exists(cmd: string): boolean {
    try {
      const { execSync } = require('child_process');
      execSync(`command -v "${cmd}"`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  existSoffice(): boolean { return this.exists(SOFFICE); }
  existCalibre(): boolean { return this.exists(EBOOK_CONVERT); }
  existMutool(): boolean { return this.exists(MUTOOL); }
  existSvgo(): boolean { return this.exists(SVGO); }
  existInkscape(): boolean { return this.exists(INKSCAPE); }

  private async convertToPDFBySoffice(src: string, workspace: string): Promise<string> {
    const base = path.basename(src, path.extname(src));
    const dst = path.join(workspace, `${base}.pdf`);
    await this.run(SOFFICE, ['--headless', '--convert-to', 'pdf', '--outdir', workspace, src]);
    if (!this.has(dst)) throw new Error(`soffice 转换失败：${src}`);
    return dst;
  }

  private async convertToPDFByCalibre(src: string, workspace: string): Promise<string> {
    const dst = path.join(workspace, 'dst.pdf');
    await this.run(EBOOK_CONVERT, [
      src, dst,
      '--paper-size', 'a4',
      '--pdf-page-margin-bottom', '36',
      '--pdf-page-margin-left', '36',
      '--pdf-page-margin-right', '36',
      '--pdf-page-margin-top', '36',
    ]);
    if (!this.has(dst)) throw new Error(`calibre 转换失败：${src}`);
    return dst;
  }

  /** 将任意格式文档转为 PDF */
  async convertToPDF(src: string, workspace: string): Promise<string> {
    const ext = path.extname(src).toLowerCase();
    switch (ext) {
      case '.epub':
      case '.mobi':
      case '.azw':
      case '.azw3':
      case '.azw4':
      case '.chm':
        return this.convertToPDFByCalibre(src, workspace);
      case '.pdf': {
        const dst = path.join(workspace, 'dst.pdf');
        fs.copyFileSync(src, dst);
        return dst;
      }
      default:
        return this.convertToPDFBySoffice(src, workspace);
    }
  }

  /** 统计 PDF 页数（mutool 优先，失败则回退解析 PDF 结构） */
  async countPDFPages(pdfPath: string): Promise<number> {
    try {
      const out = await this.run(MUTOOL, ['show', pdfPath, 'pages']);
      const lines = out.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim().toLowerCase();
        if (line.startsWith('page')) {
          const n = parseInt(line.split('=')[0].replace('page', '').trim(), 10);
          if (n > 0) return n;
        }
      }
    } catch (e) {
      this.logger.warn(`mutool 统计页数失败，回退：${e.message}`);
    }
    return this.countPDFPagesFallback(pdfPath);
  }

  private countPDFPagesFallback(pdfPath: string): number {
    const content = fs.readFileSync(pdfPath).toString('latin1');
    let count = 0;
    let idx = 0;
    // 统计 "/Type /Page" 出现次数（不含 /Pages）
    while ((idx = content.indexOf('/Type', idx)) !== -1) {
      const seg = content.slice(idx, idx + 32);
      if (/\/Type\s*\/Page[^s]/.test(seg)) count++;
      idx += 5;
    }
    if (count > 0) return count;
    // 回退：统计 /Pages 计数
    const arr = content.split('/Pages');
    if (arr.length > 1) {
      const last = arr[arr.length - 1].split('endobj')[0];
      return Math.max(0, (last.match(/0 R/g) || []).length - 1);
    }
    return 0;
  }

  /** 将 PDF 按页转为预览图（png/jpg/webp/svg） */
  async convertPDFToPages(
    src: string,
    workspace: string,
    fromPage: number,
    toPage: number,
    ext: string,
  ): Promise<ConvertPage[]> {
    const hasMutool = this.existMutool();
    let pages: ConvertPage[] = [];
    if (hasMutool) {
      try {
        pages = await this.convertPDFToPageByMutool(src, workspace, fromPage, toPage, ext);
      } catch (e) {
        this.logger.warn(`mutool 转页失败，回退 inkscape：${e.message}`);
        pages = await this.convertPDFToPageByInkscape(src, workspace, fromPage, toPage, ext);
      }
    } else {
      pages = await this.convertPDFToPageByInkscape(src, workspace, fromPage, toPage, ext);
    }
    return pages;
  }

  private async convertPDFToPageByMutool(
    src: string, workspace: string, fromPage: number, toPage: number, ext: string,
  ): Promise<ConvertPage[]> {
    const cacheFormat = path.join(workspace, `%d${ext}`);
    const pageRange = `${fromPage}-${toPage}`;
    await this.run(MUTOOL, ['draw', '-w', '1000', '-o', cacheFormat, src, pageRange]);
    const pages: ConvertPage[] = [];
    for (let i = 0; i <= toPage - fromPage; i++) {
      const pagePath = cacheFormat.replace('%d', String(i + 1));
      if (!this.has(pagePath)) break;
      pages.push({ page_num: fromPage + i, page_path: pagePath });
    }
    return pages;
  }

  private async convertPDFToPageByInkscape(
    src: string, workspace: string, fromPage: number, toPage: number, ext: string,
  ): Promise<ConvertPage[]> {
    const cacheFormat = path.join(workspace, `%d${ext}`);
    const pages: ConvertPage[] = [];
    for (let i = 0; i <= toPage - fromPage; i++) {
      const pagePath = cacheFormat.replace('%d', String(i + 1));
      const pageNo = String(fromPage + i);
      try {
        await this.run(INKSCAPE, ['-o', pagePath, '--pdf-page', pageNo, '--pdf-poppler', src]);
      } catch {
        await this.run(INKSCAPE, ['-o', pagePath, '--pages', pageNo, '--pdf-poppler', src]);
      }
      if (!this.has(pagePath)) break;
      pages.push({ page_num: fromPage + i, page_path: pagePath });
    }
    return pages;
  }

  /** 使用 ImageMagick 将 PNG 转为 JPG / WEBP */
  async convertImageByImagemagick(src: string, dst: string): Promise<void> {
    await this.run(IMAGE_MAGICK, [src, dst]);
  }

  /** 将 SVG 文件压缩为 gzip 格式 */
  compressSVGByGZIP(svgFile: string): string {
    const dst = svgFile.replace(path.extname(svgFile), '.gzip.svg');
    let svgBytes = fs.readFileSync(svgFile);
    svgBytes = Buffer.from(
      svgBytes.toString('utf8')
        .replace(/data-text="</g, 'data-text="&lt;')
        .replace(/data-text=">/g, 'data-text="&gt;'),
    );
    const gz = zlib.gzipSync(svgBytes, { level: zlib.constants.Z_BEST_COMPRESSION });
    fs.writeFileSync(dst, gz);
    return dst;
  }

  /** 生成封面图（默认取第 1 页预览图，另存 cover.png） */
  async generateCover(firstPagePath: string, outCover: string): Promise<string> {
    try {
      if (/\.(png|jpg|jpeg|webp)$/.test(firstPagePath)) {
        fs.copyFileSync(firstPagePath, outCover);
        return outCover;
      }
      // svg -> png 需要 inkscape
      await this.run(INKSCAPE, ['-o', outCover, firstPagePath]);
      return outCover;
    } catch {
      return '';
    }
  }

  /** 计算文件 MD5（32 位十六进制），用于附件去重与存储路径 */
  static md5File(filePath: string): string {
    const hash = crypto.createHash('md5');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
  }
}