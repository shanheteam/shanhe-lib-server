import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { load, type CheerioAPI, type Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import {
  SpiderUrl,
  SpiderArticleList,
  SpiderArticleDetail,
  SpiderDocument,
  Document,
  Attachment,
  DocumentCategory,
  Article,
  ArticleCategory,
  Category,
  User,
} from '../../entities';
import { ConfigService } from '../../config/config.service';
import { Biz } from '../../common/biz.exception';
import { DocumentStatus } from '../document/document.service';
import {
  documentExtOf,
  genDocumentUuid,
  md5,
  parseCategoryIds,
  parseReplaceRules,
  splitLines,
  titleFromUrl,
} from './spider.util';

// 文档嗅探状态
const URL_STATUS = { PENDING: 0, RUNNING: 1, DONE: 2, FAILED: 3 } as const;
// 文章/文档采集与发布状态
const TASK_STATUS = {
  WAIT: 0, QUEUE_CRAWL: 1, CRAWLING: 2, CRAWL_OK: 3, CRAWL_FAIL: 4,
  QUEUE_PUBLISH: 5, PUBLISHING: 6, PUBLISH_OK: 7, PUBLISH_FAIL: 8,
} as const;

/**
 * 采集引擎：页面嗅探、文章采集、文档下载与发布。
 * 供 CRUD 服务手动触发与 SpiderWorkerService 定时调度共用。
 */
@Injectable()
export class SpiderCrawlerService {
  private readonly logger = new Logger(SpiderCrawlerService.name);
  private runningUrl = new Set<number>();
  private runningSource = new Set<number>();
  private runningDetail = new Set<number>();
  private runningDocument = new Set<number>();

  constructor(
    @InjectRepository(SpiderUrl)
    private readonly urlRepo: Repository<SpiderUrl>,
    @InjectRepository(SpiderArticleList)
    private readonly sourceRepo: Repository<SpiderArticleList>,
    @InjectRepository(SpiderArticleDetail)
    private readonly detailRepo: Repository<SpiderArticleDetail>,
    @InjectRepository(SpiderDocument)
    private readonly docRepo: Repository<SpiderDocument>,
    @InjectRepository(Document)
    private readonly formalDocRepo: Repository<Document>,
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    @InjectRepository(DocumentCategory)
    private readonly docCateRepo: Repository<DocumentCategory>,
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
    @InjectRepository(ArticleCategory)
    private readonly articleCateRepo: Repository<ArticleCategory>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------- HTTP ----------

  private async httpRequest(url: string, binary: boolean): Promise<{ body: Buffer; contentType: string }> {
    const timeoutMs = Math.max(3, this.config.getInt('spider', 'timeout', 15)) * 1000;
    const ua = this.config.get('spider', 'user_agent', 'Mozilla/5.0 (compatible; moredoc-spider)');
    const proxy = this.config.get('spider', 'proxy', '');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let resp: Response;
      if (proxy) {
        // 可选：安装 undici 后支持代理；未安装则退化为直连
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { ProxyAgent, fetch: undiciFetch } = require('undici');
          resp = await undiciFetch(url, {
            dispatcher: new ProxyAgent(proxy),
            headers: { 'User-Agent': ua, Accept: '*/*' },
            signal: controller.signal,
          });
        } catch {
          resp = await fetch(url, {
            headers: { 'User-Agent': ua, Accept: '*/*' },
            signal: controller.signal,
          });
        }
      } else {
        resp = await fetch(url, {
          headers: { 'User-Agent': ua, Accept: '*/*' },
          signal: controller.signal,
        });
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ab = await resp.arrayBuffer();
      return {
        body: Buffer.from(ab),
        contentType: resp.headers.get('content-type') ?? '',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 抓取页面 HTML；enable_browser=true 时优先走浏览器渲染服务，失败则退化为直连 */
  private async fetchHtml(url: string, enableBrowser: boolean): Promise<string> {
    const renderService = this.config.get('spider', 'render_service', '');
    if (enableBrowser && renderService) {
      try {
        const resp = await fetch(renderService, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const text = await resp.text();
        if (resp.ok && text) {
          try {
            const json = JSON.parse(text);
            if (typeof json.html === 'string' && json.html) return json.html;
          } catch {
            return text; // 渲染服务直接返回 HTML
          }
        }
      } catch (e) {
        this.logger.warn(`渲染服务不可用，退化为直连：${(e as Error).message}`);
      }
    }
    const { body } = await this.httpRequest(url, false);
    return body.toString('utf8');
  }

  // ---------- 选择器工具 ----------

  /** 多行选择器按顺序尝试，返回第一个命中的结果 */
  private pickByRules($: CheerioAPI, rules: string, scope?: Cheerio<AnyNode>): { el: Cheerio<AnyNode>; rule: string } | null {
    for (const rule of splitLines(rules)) {
      const el = scope ? scope.find(rule) : $(rule);
      if (el.length) return { el: el.first(), rule };
    }
    return null;
  }

  private matchUrlByKeywords(url: string, row: { url_prefix: string; include_url_keywords: string; exclude_url_keywords: string }): boolean {
    const prefixes = splitLines(row.url_prefix);
    if (prefixes.length && !prefixes.some((p) => url.startsWith(p))) return false;
    const includes = splitLines(row.include_url_keywords);
    if (includes.length && !includes.some((k) => url.includes(k))) return false;
    for (const ex of splitLines(row.exclude_url_keywords)) {
      if (url.includes(ex)) return false;
    }
    return true;
  }

  // ---------- 文档嗅探 ----------

  async runUrl(id: number): Promise<void> {
    if (this.runningUrl.has(id)) return;
    const row = await this.urlRepo.findOne({ where: { id } });
    if (!row) return;
    this.runningUrl.add(id);
    await this.urlRepo.update(id, { status: URL_STATUS.RUNNING, error: '', updated_at: new Date() });
    try {
      await this.sniffUrl(row);
      await this.urlRepo.update(id, { status: URL_STATUS.DONE, error: '', total: row.total, updated_at: new Date() });
      // 种子页发现的下一层链接立即再嗅探一层，便于手动使用
      if (row.level === 0) {
        const children = await this.urlRepo.find({
          where: { level: 1, status: URL_STATUS.PENDING },
          order: { id: 'ASC' },
          take: 20,
        });
        for (const child of children) {
          await this.runUrl(Number(child.id));
        }
      }
    } catch (e) {
      await this.urlRepo.update(id, {
        status: URL_STATUS.FAILED,
        error: String((e as Error).message || e).slice(0, 2000),
        updated_at: new Date(),
      });
    } finally {
      this.runningUrl.delete(id);
    }
  }

  private async sniffUrl(row: SpiderUrl): Promise<void> {
    const html = await this.fetchHtml(row.url, !!row.enable_browser);
    const $ = load(html, { baseURI: row.url });
    const seen = new Set<string>();
    const childUrls: string[] = [];
    const docPromises: Array<Promise<void>> = [];

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) return;
      let abs = href;
      try {
        abs = new URL(href, row.url).href;
      } catch {
        return;
      }
      abs = abs.split('#')[0];
      if (seen.has(abs)) return;
      seen.add(abs);
      if (!this.matchUrlByKeywords(abs, row)) return;

      const ext = documentExtOf(abs);
      if (ext) {
        docPromises.push(this.upsertSpiderDocument(abs, $(el).text().trim(), ext));
      } else if (row.level < 5) {
        childUrls.push(abs);
      }
    });

    await Promise.all(docPromises);
    row.total = docPromises.length;

    // 登记下一层页面链接
    if (childUrls.length) {
      const exist = await this.urlRepo.find({ select: ['url'] });
      const existSet = new Set(exist.map((x) => x.url));
      const rows = childUrls
        .filter((u) => !existSet.has(u))
        .slice(0, 200)
        .map((u) =>
          this.urlRepo.create({
            url: u,
            status: URL_STATUS.PENDING,
            total: 0,
            enable_browser: !!row.enable_browser,
            frequency: 0,
            level: row.level + 1,
            url_prefix: row.url_prefix,
            include_url_keywords: row.include_url_keywords,
            exclude_url_keywords: row.exclude_url_keywords,
            error: '',
            created_at: new Date(),
            updated_at: new Date(),
          }),
        );
      if (rows.length) await this.urlRepo.save(rows);
    }
  }

  private async upsertSpiderDocument(absUrl: string, anchorText: string, ext: string): Promise<void> {
    const exists = await this.docRepo.findOne({ where: { url: absUrl }, select: ['id'] });
    if (exists) return;
    const entity = this.docRepo.create({
      url: absUrl,
      status: TASK_STATUS.WAIT,
      language: '',
      title: '',
      title_from_href: anchorText.slice(0, 500),
      title_from_url: (titleFromUrl(absUrl) || anchorText).slice(0, 500),
      title_from_attachment: '',
      price: 0,
      size: 0,
      ext,
      content_type: '',
      save_path: '',
      user_id: 0,
      category_id: '',
      document_id: 0,
      error: '',
      created_at: new Date(),
      updated_at: new Date(),
    });
    await this.docRepo.save(entity);
  }

  // ---------- 文章列表嗅探 ----------

  async runSource(id: number): Promise<void> {
    if (this.runningSource.has(id)) return;
    const row = await this.sourceRepo.findOne({ where: { id } });
    if (!row) return;
    this.runningSource.add(id);
    await this.sourceRepo.update(id, { status: URL_STATUS.RUNNING, error: '', updated_at: new Date() });
    try {
      const html = await this.fetchHtml(row.url, !!row.enable_browser);
      const $ = load(html, { baseURI: row.url });
      const picked = this.pickByRules($, row.list_rules);
      if (!picked) throw new Error('列表规则未命中任何条目，请检查 list_rules 选择器');

      const items: SpiderArticleDetail[] = [];
      const candidates: string[] = [];
      picked.el.each((_, el) => {
        const node = $(el);
        const anchor = node.is('a') ? node : node.find('a').first();
        const href = anchor.attr('href') ?? '';
        if (!href) return;
        let abs = href;
        try {
          abs = new URL(href, row.url).href.split('#')[0];
        } catch {
          return;
        }
        if (!candidates.includes(abs)) candidates.push(abs);
        const title = anchor.text().trim().slice(0, 500);
        items.push(
          this.detailRepo.create({
            article_list_id: Number(row.id),
            status: TASK_STATUS.WAIT,
            title,
            url: abs,
            source: new URL(row.url).host,
            description: '',
            keywords: '',
            content: '',
            content_title_rules: row.content_title_rules,
            content_rules: row.content_rules,
            content_exclude_rules: row.content_exclude_rules,
            content_replace_rules: row.content_replace_rules,
            enable_browser: !!row.enable_browser,
            article_id: 0,
            user_id: 0,
            category_id: '',
            error: '',
          }),
        );
      });

      // 按 URL 去重后落库
      if (items.length) {
        const exist = await this.detailRepo.find({
          where: { article_list_id: Number(row.id) },
          select: ['url'],
        });
        const existSet = new Set(exist.map((x) => x.url));
        const fresh = items.filter((it) => !existSet.has(it.url));
        if (fresh.length) await this.detailRepo.save(fresh);
        await this.sourceRepo.update(id, { total: fresh.length, status: URL_STATUS.DONE, error: '', updated_at: new Date() });
      } else {
        await this.sourceRepo.update(id, { total: 0, status: URL_STATUS.DONE, error: '', updated_at: new Date() });
      }
    } catch (e) {
      await this.sourceRepo.update(id, {
        status: URL_STATUS.FAILED,
        error: String((e as Error).message || e).slice(0, 2000),
        updated_at: new Date(),
      });
    } finally {
      this.runningSource.delete(id);
    }
  }

  // ---------- 文章采集 ----------

  async runDetailCrawl(id: number): Promise<void> {
    if (this.runningDetail.has(id)) return;
    const row = await this.detailRepo.findOne({ where: { id } });
    if (!row) return;
    this.runningDetail.add(id);
    await this.detailRepo.update(id, { status: TASK_STATUS.CRAWLING, error: '', updated_at: new Date() });
    try {
      const html = await this.fetchHtml(row.url, !!row.enable_browser);
      const $ = load(html, { baseURI: row.url });

      let title = row.title;
      const pickedTitle = this.pickByRules($, row.content_title_rules);
      if (pickedTitle) title = pickedTitle.el.text().trim().slice(0, 500);
      if (!title) title = ($('title').first().text().trim() || titleFromUrl(row.url)).slice(0, 500);

      const pickedContent = this.pickByRules($, row.content_rules);
      if (!pickedContent) throw new Error('正文规则未命中，请检查 content_rules 选择器');
      for (const exRule of splitLines(row.content_exclude_rules)) {
        pickedContent.el.find(exRule).remove();
      }
      let content = pickedContent.el.html() ?? '';
      for (const [from, to] of parseReplaceRules(row.content_replace_rules)) {
        content = content.split(from).join(to);
      }
      if (!content.trim()) throw new Error('正文内容为空');

      const plainText = content
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);

      await this.detailRepo.update(id, {
        title,
        content,
        description: plainText,
        source: row.source || new URL(row.url).host,
        status: TASK_STATUS.CRAWL_OK,
        error: '',
        updated_at: new Date(),
      });
    } catch (e) {
      await this.detailRepo.update(id, {
        status: TASK_STATUS.CRAWL_FAIL,
        error: String((e as Error).message || e).slice(0, 2000),
        updated_at: new Date(),
      });
    } finally {
      this.runningDetail.delete(id);
    }
  }

  // ---------- 文章发布 ----------

  /**
   * 通用网页文章抓取（对应专业版 POST /api/v1/article/crawl）。
   * mode=0：自动识别正文与标题；mode=1：使用传入的 CSS 选择器。
   * 返回 { title, content, source, description, keywords }。
   */
  async crawlArticle(input: {
    url?: string;
    mode?: number;
    select?: string;
    title_selector?: string;
    exclude?: string;
    replace?: string;
    enable_browser?: boolean;
  }): Promise<{ title: string; content: string; source: string; description: string; keywords: string }> {
    const targetUrl = String(input.url ?? '').trim();
    if (!/^https?:\/\//i.test(targetUrl)) throw Biz.invalidArgument('链接不正确，需以 http(s):// 开头');

    const html = await this.fetchHtml(targetUrl, !!input.enable_browser);
    const $ = load(html, { baseURI: targetUrl });
    const source = (() => {
      try {
        return new URL(targetUrl).host;
      } catch {
        return '';
      }
    })();
    const metaDesc =
      $('meta[name="description"]').attr('content')?.trim() ||
      $('meta[property="og:description"]').attr('content')?.trim() ||
      '';
    const metaKeywords = $('meta[name="keywords"]').attr('content')?.trim() || '';

    let title = '';
    let contentEl: Cheerio<AnyNode>;
    if (Number(input.mode) === 1 && String(input.select ?? '').trim()) {
      const picked = this.pickByRules($, String(input.select));
      if (!picked) throw Biz.invalidArgument('正文规则未命中，请检查选择器');
      contentEl = picked.el;
      const pickedTitle = this.pickByRules($, String(input.title_selector ?? ''));
      title = pickedTitle
        ? pickedTitle.el.text().trim()
        : $('title').first().text().trim();
    } else {
      title = (
        $('h1').first().text().trim() ||
        $('meta[property="og:title"]').attr('content')?.trim() ||
        $('title').first().text().trim()
      );
      contentEl = this.guessMainContent($);
    }

    for (const exRule of splitLines(String(input.exclude ?? ''))) {
      contentEl.find(exRule).remove();
    }
    let content = contentEl.html() ?? '';
    for (const [from, to] of parseReplaceRules(String(input.replace ?? ''))) {
      content = content.split(from).join(to);
    }
    if (!content.trim()) throw Biz.internal('正文内容为空');

    const description =
      metaDesc ||
      content
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);

    return {
      title: title.slice(0, 500),
      content,
      source,
      description,
      keywords: metaKeywords,
    };
  }

  /** 自动模式下按常见容器选择器猜测正文，命中文本最多者优先 */
  private guessMainContent($: CheerioAPI): Cheerio<AnyNode> {
    const candidates = [
      'article',
      '.article-content',
      '#article-content',
      '.article_content',
      '.post-content',
      '.entry-content',
      '.main-content',
      '#content',
      '.content',
      'main',
    ];
    let best: Cheerio<AnyNode> | null = null;
    let bestLen = 0;
    for (const sel of candidates) {
      $(sel).each((_, el) => {
        const node = $(el);
        const len = node.text().replace(/\s+/g, '').length;
        if (len > bestLen) {
          bestLen = len;
          best = node;
        }
      });
    }
    return (best as Cheerio<AnyNode> | null) ?? $('body').first();
  }

  // ---------- 文章发布 ----------

  async runDetailPublish(id: number): Promise<void> {
    if (this.runningDetail.has(id)) return;
    const row = await this.detailRepo.findOne({ where: { id } });
    if (!row) return;
    if (row.status !== TASK_STATUS.CRAWL_OK && row.status !== TASK_STATUS.PUBLISH_FAIL) {
      // 仅允许采集成功/发布失败的文章发布
      if (row.status !== TASK_STATUS.QUEUE_PUBLISH) return;
    }
    this.runningDetail.add(id);
    await this.detailRepo.update(id, { status: TASK_STATUS.PUBLISHING, error: '', updated_at: new Date() });
    try {
      const userId = row.user_id > 0 ? row.user_id : 1;
      const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id'] });
      if (!user) throw new Error('发布用户不存在，请先在编辑中指定用户');

      const categoryIds = parseCategoryIds(row.category_id);
      const validCates = categoryIds.length
        ? await this.categoryRepo.find({ where: { id: In(categoryIds) }, select: ['id'] })
        : [];
      const cateIds = validCates.map((c) => Number(c.id));

      const articleId = await this.dataSource.transaction(async (manager) => {
        let identifier = '';
        for (let i = 0; i < 5; i++) {
          identifier = md5(crypto.randomUUID() + Date.now() + i).slice(0, 16);
          const exist = await manager.findOne(Article, { where: { identifier }, select: ['id'] });
          if (!exist) break;
        }
        const now = new Date();
        const article = await manager.save(Article, manager.create(Article, {
          identifier,
          user_id: userId,
          title: row.title,
          keywords: row.keywords,
          description: row.description,
          content: row.content,
          source: row.source || '网络采集',
          source_url: row.url,
          status: 1, // 直接审核通过
          created_at: now,
          updated_at: now,
        }));
        if (cateIds.length) {
          await manager.increment(Category, { id: In(cateIds) }, 'doc_count', 1);
          await manager.save(ArticleCategory, cateIds.map((cid) =>
            manager.create(ArticleCategory, {
              article_id: Number(article.id),
              category_id: cid,
              created_at: now,
              updated_at: now,
            }),
          ));
        }
        await manager.increment(User, { id: userId }, 'article_count', 1);
        return Number(article.id);
      });

      await this.detailRepo.update(id, {
        article_id: articleId,
        published_at: new Date(),
        status: TASK_STATUS.PUBLISH_OK,
        error: '',
        updated_at: new Date(),
      });
    } catch (e) {
      await this.detailRepo.update(id, {
        status: TASK_STATUS.PUBLISH_FAIL,
        error: String((e as Error).message || e).slice(0, 2000),
        updated_at: new Date(),
      });
    } finally {
      this.runningDetail.delete(id);
    }
  }

  // ---------- 文档下载 ----------

  async runDocumentDownload(id: number): Promise<void> {
    if (this.runningDocument.has(id)) return;
    const row = await this.docRepo.findOne({ where: { id } });
    if (!row) return;
    this.runningDocument.add(id);
    await this.docRepo.update(id, { status: TASK_STATUS.CRAWLING, error: '', updated_at: new Date() });
    try {
      const { body, contentType } = await this.httpRequest(row.url, true);

      const urlExt = documentExtOf(row.url);
      const ext = urlExt || row.ext || '';
      const hash = md5(body);
      const relPath = `documents/${hash.slice(0, 5).split('').join('/')}/${hash}${ext ? '.' + ext : ''}`;
      const absPath = path.resolve(process.cwd(), relPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, body);

      const userId = row.user_id > 0 ? Number(row.user_id) : 1;
      const attachment = await this.attachmentRepo.save(this.attachmentRepo.create({
        hash,
        user_id: userId,
        type_id: 0,
        type: 2,
        enable: true,
        path: '/' + relPath,
        name: row.title_from_href || row.title_from_url || titleFromUrl(row.url),
        size: body.length,
        ext: '.' + ext,
        ip: '',
        created_at: new Date(),
        updated_at: new Date(),
      }));

      await this.docRepo.update(id, {
        size: body.length,
        ext,
        content_type: contentType.slice(0, 128),
        save_path: '/' + relPath + `#${attachment.id}`,
        status: TASK_STATUS.CRAWL_OK,
        error: '',
        updated_at: new Date(),
      });
    } catch (e) {
      await this.docRepo.update(id, {
        status: TASK_STATUS.CRAWL_FAIL,
        error: String((e as Error).message || e).slice(0, 2000),
        updated_at: new Date(),
      });
    } finally {
      this.runningDocument.delete(id);
    }
  }

  // ---------- 文档发布 ----------

  async runDocumentPublish(id: number): Promise<void> {
    if (this.runningDocument.has(id)) return;
    const row = await this.docRepo.findOne({ where: { id } });
    if (!row) return;
    if (row.status !== TASK_STATUS.CRAWL_OK && row.status !== TASK_STATUS.PUBLISH_FAIL && row.status !== TASK_STATUS.QUEUE_PUBLISH) {
      return;
    }
    this.runningDocument.add(id);
    await this.docRepo.update(id, { status: TASK_STATUS.PUBLISHING, error: '', updated_at: new Date() });
    try {
      if (!row.save_path) throw new Error('文件尚未下载，请先入队下载');
      const userId = row.user_id > 0 ? Number(row.user_id) : 1;
      const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id'] });
      if (!user) throw new Error('发布用户不存在，请先在编辑中指定用户');

      // save_path 形如 "/documents/xx/x/hash.pdf#123"，# 后为附件 ID
      const [filePath, attachIdRaw] = row.save_path.split('#');
      let attachmentId = Number(attachIdRaw);
      if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
        const hash = path.basename(filePath).replace(/\.[^.]+$/, '');
        const attachment = await this.attachmentRepo.findOne({ where: { hash, type: 2 } });
        attachmentId = attachment ? Number(attachment.id) : 0;
      }
      const attachment = await this.attachmentRepo.findOne({ where: { id: attachmentId } });
      if (!attachment) throw new Error('下载的附件记录不存在，请重新下载');

      const categoryIds = parseCategoryIds(row.category_id);
      const validCates = categoryIds.length
        ? await this.categoryRepo.find({ where: { id: In(categoryIds) }, select: ['id'] })
        : [];
      const cateIds = validCates.map((c) => Number(c.id));

      const title = (row.title || row.title_from_href || row.title_from_url || row.title_from_attachment || '未命名文档').slice(0, 255);
      const now = new Date();

      const documentId = await this.dataSource.transaction(async (manager) => {
        if (cateIds.length) {
          await manager.increment(Category, { id: In(cateIds) }, 'doc_count', 1);
        }
        const doc = await manager.save(Document, manager.create(Document, {
          title,
          keywords: title,
          description: '',
          user_id: userId,
          price: Number(row.price) || 0,
          size: Number(row.size) || Number(attachment.size) || 0,
          ext: (row.ext || attachment.ext || '').replace(/^\./, ''),
          status: DocumentStatus.Pending, // 交给文档转换 worker
          uuid: genDocumentUuid(),
          language: row.language ?? '',
          source: '网络采集',
          source_url: row.url,
          preview_ext: '.webp',
          created_at: now,
          updated_at: now,
        }));
        await manager.update(Attachment, { id: attachmentId }, { type_id: Number(doc.id), user_id: userId });
        if (cateIds.length) {
          await manager.save(DocumentCategory, cateIds.map((cid) =>
            manager.create(DocumentCategory, { document_id: Number(doc.id), category_id: cid }),
          ));
        }
        await manager.increment(User, { id: userId }, 'doc_count', 1);
        return Number(doc.id);
      });

      await this.docRepo.update(id, {
        document_id: documentId,
        title,
        status: TASK_STATUS.PUBLISH_OK,
        error: '',
        updated_at: new Date(),
      });
    } catch (e) {
      await this.docRepo.update(id, {
        status: TASK_STATUS.PUBLISH_FAIL,
        error: String((e as Error).message || e).slice(0, 2000),
        updated_at: new Date(),
      });
    } finally {
      this.runningDocument.delete(id);
    }
  }

  // ---------- 定时调度 ----------

  /** 单次调度：由 worker 周期调用。仅处理队列态任务，失败态不自动重试。 */
  async tick(): Promise<void> {
    if (!this.config.getBool('spider', 'enable', false)) return;
    const concurrency = Math.min(Math.max(this.config.getInt('spider', 'concurrency', 3), 1), 10);
    const due = new Date(Date.now() - this.config.getInt('spider', 'frequency', 0) * 86400000);

    // 待嗅探链接 + 到期的周期嗅探链接
    const dueUrls = await this.urlRepo.find({
      where: { status: URL_STATUS.PENDING },
      order: { id: 'ASC' },
      take: concurrency,
    });
    const periodicUrls = await this.urlRepo
      .createQueryBuilder('u')
      .where('u.status = :done', { done: URL_STATUS.DONE })
      .andWhere('u.frequency > 0')
      .andWhere('u.updated_at < :due', { due })
      .orderBy('u.id', 'ASC')
      .limit(concurrency)
      .getMany();
    for (const u of periodicUrls) {
      await this.urlRepo.update(u.id, { status: URL_STATUS.PENDING });
      dueUrls.push(u);
    }
    await Promise.all(dueUrls.slice(0, concurrency).map((u) => this.runUrl(Number(u.id))));

    const dueSources = await this.sourceRepo.find({
      where: { status: URL_STATUS.PENDING },
      order: { id: 'ASC' },
      take: concurrency,
    });
    await Promise.all(dueSources.map((s) => this.runSource(Number(s.id))));

    const crawlDetails = await this.detailRepo.find({
      where: { status: TASK_STATUS.QUEUE_CRAWL },
      order: { id: 'ASC' },
      take: concurrency,
    });
    await Promise.all(crawlDetails.map((d) => this.runDetailCrawl(Number(d.id))));

    const publishDetails = await this.detailRepo.find({
      where: { status: TASK_STATUS.QUEUE_PUBLISH },
      order: { id: 'ASC' },
      take: concurrency,
    });
    await Promise.all(publishDetails.map((d) => this.runDetailPublish(Number(d.id))));

    const downloads = await this.docRepo.find({
      where: { status: TASK_STATUS.QUEUE_CRAWL },
      order: { id: 'ASC' },
      take: concurrency,
    });
    await Promise.all(downloads.map((d) => this.runDocumentDownload(Number(d.id))));

    const publishes = await this.docRepo.find({
      where: { status: TASK_STATUS.QUEUE_PUBLISH },
      order: { id: 'ASC' },
      take: concurrency,
    });
    await Promise.all(publishes.map((d) => this.runDocumentPublish(Number(d.id))));
  }
}
