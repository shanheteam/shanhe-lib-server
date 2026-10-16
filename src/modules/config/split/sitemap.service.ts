import * as fs from 'fs';
import * as path from 'path';
import { Repository, IsNull } from 'typeorm';
import { Document, Article, Category, Config } from '../../../entities';

/** 从 config.controller.ts 拆分出的站点地图生成子服务 */
export class SitemapService {
  constructor(
    private readonly documentRepo: Repository<Document>,
    private readonly articleRepo: Repository<Article>,
    private readonly categoryRepo: Repository<Category>,
    private readonly configRepo: Repository<Config>,
  ) {}

  /** PUT /sitemap：重建文档/文章/静态页面站点地图 */
  async updateSitemap() {
    const domain = (await this.getConfigValue('system', 'domain')).replace(/\/+$/, '');
    // 站点地图**只生成在后端本地磁盘**（不传 OSS），由 main.ts 的
    // useStaticAssets(sitemapDir, { prefix: '/sitemap' }) 对外提供；
    // 索引里的 loc 一律使用站点域名，前台再由 EdgeOne Pages Function 代理 /sitemap/*，
    // 这样索引与子文件的地址都在站点域名下，爬虫无需跨域。
    const sitemapBase = `${domain}/sitemap`;
    const limit = 10000;
    const indexes: Array<{ loc: string; lastmod: string }> = [];

    let page = 1;
    // 文档站点地图
    for (;;) {
      const documents = await this.documentRepo.find({
        select: { id: true, updated_at: true, uuid: true },
        where: { deleted_at: IsNull() },
        order: { id: 'ASC' },
        skip: (page - 1) * limit,
        take: limit,
      });
      if (documents.length === 0) break;
      const file = `sitemap/documents-${page}.xml`;
      const now = new Date().toISOString();
      const urls = documents.map((doc) => ({
        loc: `${domain}/document/${doc.uuid}`,
        lastmod: doc.updated_at ? doc.updated_at.toISOString() : now,
        changefreq: 'weekly',
        priority: '0.7',
      }));
      await this.putSitemapFile(file, this.buildSitemapXml(urls));
      indexes.push({ loc: `${sitemapBase}/documents-${page}.xml`, lastmod: now });
      page++;
    }

    page = 1;
    // 文章站点地图
    for (;;) {
      const articles = await this.articleRepo.find({
        select: { id: true, updated_at: true, identifier: true },
        where: { deleted_at: IsNull() },
        order: { id: 'ASC' },
        skip: (page - 1) * limit,
        take: limit,
      });
      if (articles.length === 0) break;
      const file = `sitemap/articles-${page}.xml`;
      const now = new Date().toISOString();
      const urls = articles.map((article) => ({
        loc: `${domain}/article/${article.identifier}`,
        lastmod: article.updated_at ? article.updated_at.toISOString() : now,
        changefreq: 'weekly',
        priority: '0.7',
      }));
      await this.putSitemapFile(file, this.buildSitemapXml(urls));
      indexes.push({ loc: `${sitemapBase}/articles-${page}.xml`, lastmod: now });
      page++;
    }

    // 静态页面 sitemap：首页（最高权重）+ 已启用的分类
    const now = new Date().toISOString();
    const categories = await this.categoryRepo.find({
      where: { enable: true },
      select: { id: true, updated_at: true },
    });
    const pageUrls: Array<{
      loc: string;
      lastmod: string;
      changefreq?: string;
      priority?: string;
    }> = [
      { loc: `${domain}/`, lastmod: now, changefreq: 'daily', priority: '1.0' },
      ...categories.map((c) => ({
        loc: `${domain}/category/${c.id}`,
        lastmod: c.updated_at ? c.updated_at.toISOString() : now,
        changefreq: 'daily',
        priority: '0.8',
      })),
    ];
    await this.putSitemapFile('sitemap/pages.xml', this.buildSitemapXml(pageUrls));
    indexes.push({ loc: `${sitemapBase}/pages.xml`, lastmod: now });

    if (indexes.length > 0) {
      await this.putSitemapFile('sitemap/sitemap.xml', this.buildSitemapIndexXml(indexes));
    }
    return {};
  }

  private async getConfigValue(category: string, name: string): Promise<string> {
    const row = await this.configRepo.findOne({ where: { category, name } });
    return row?.value ?? '';
  }

  /** 写入站点地图文件——**只写后端本地磁盘**，不再上传 OSS（原因注释从 controller 原样保留）。 */
  private async putSitemapFile(relativePath: string, content: string): Promise<void> {
    this.writeFile(relativePath, content);
  }

  private writeFile(relativePath: string, content: string) {
    const fullPath = path.resolve(process.cwd(), relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  private buildSitemapXml(
    urls: Array<{
      loc: string;
      lastmod: string;
      changefreq?: string;
      priority?: string;
    }>,
  ): string {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ];
    for (const url of urls) {
      lines.push(
        '  <url>',
        `    <loc>${this.escapeXml(url.loc)}</loc>`,
        `    <lastmod>${this.escapeXml(url.lastmod)}</lastmod>`,
        `    <changefreq>${url.changefreq || 'daily'}</changefreq>`,
        `    <priority>${url.priority || '1.0'}</priority>`,
        '  </url>',
      );
    }
    lines.push('</urlset>');
    return lines.join('\n');
  }

  private buildSitemapIndexXml(indexes: Array<{ loc: string; lastmod: string }>): string {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ];
    for (const item of indexes) {
      lines.push(
        '  <sitemap>',
        `    <loc>${this.escapeXml(item.loc)}</loc>`,
        `    <lastmod>${this.escapeXml(item.lastmod)}</lastmod>`,
        '  </sitemap>',
      );
    }
    lines.push('</sitemapindex>');
    return lines.join('\n');
  }

  private escapeXml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}