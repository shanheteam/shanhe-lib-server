import { Controller, Get, Put, Post, Body, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, IsNull, In } from 'typeorm';
import { execSync } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  Config,
  Language,
  User,
  Document,
  Category,
  Article,
  Comment,
  Banner,
  Friendlink,
  Report,
} from '../../entities';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Biz } from '../../common/biz.exception';
import { PermissionService } from '../../auth/permission.service';
import { ConfigService } from '../../config/config.service';
import { JwtUser } from '../../auth/jwt-user.type';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: APP_VERSION } = require('../../../package.json');
const APP_HASH = process.env.MOREDOC_GIT_HASH || '';
const APP_BUILD_AT = process.env.MOREDOC_BUILD_AT || '';

interface ListConfigQuery {
  category?: string | string[];
}

interface UpdateConfigBody {
  config?: Array<{ id?: number; name?: string; value?: string; category?: string }>;
}

@Controller()
export class ConfigController {
  constructor(
    @InjectRepository(Config)
    private readonly configRepo: Repository<Config>,
    @InjectRepository(Language)
    private readonly languageRepo: Repository<Language>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(Banner)
    private readonly bannerRepo: Repository<Banner>,
    @InjectRepository(Friendlink)
    private readonly friendlinkRepo: Repository<Friendlink>,
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    private readonly permissionService: PermissionService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  @Public()
  @Get('settings')
  async getSettings() {
    const rows = await this.configRepo.find();
    const byCategory = (category: string): Record<string, string> => {
      const map: Record<string, string> = {};
      for (const row of rows) {
        if (row.category === category) map[row.name] = row.value ?? '';
      }
      return map;
    };

    const system = byCategory('system');
    const footer = byCategory('footer');
    const security = byCategory('security');
    const display = byCategory('display');
    const score = byCategory('score');
    const download = byCategory('download');

    const str = (map: Record<string, string>, key: string) => map[key] ?? '';
    const bool = (map: Record<string, string>, key: string, def = false) => {
      const v = map[key];
      if (v === undefined || v === '') return def;
      return v === 'true' || v === '1';
    };
    const int = (map: Record<string, string>, key: string, def = 0) => {
      const n = parseInt(map[key], 10);
      return Number.isNaN(n) ? def : n;
    };
    const list = (map: Record<string, string>, key: string) =>
      (map[key] ?? '')
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

    const langs = await this.languageRepo.find({
      select: ['id', 'language', 'code'],
      where: { enable: true },
      order: { sort: 'ASC' },
    });

    return {
      system: {
        domain: str(system, 'domain'),
        title: str(system, 'title'),
        keywords: str(system, 'keywords'),
        description: str(system, 'description'),
        logo: str(system, 'logo'),
        favicon: str(system, 'favicon'),
        icp: str(system, 'icp'),
        analytics: str(system, 'analytics').trim(),
        sitename: str(system, 'sitename'),
        copyright_start_year: str(system, 'copyright_start_year'),
        register_background: str(system, 'register_background'),
        login_background: str(system, 'login_background'),
        recommend_words: list(system, 'recommend_words'),
        version: APP_VERSION,
        credit_name: str(score, 'credit_name'),
        sec_icp: str(system, 'sec_icp'),
      },
      footer: {
        about: str(footer, 'about'),
        contact: str(footer, 'contact'),
        agreement: str(footer, 'agreement'),
        copyright: str(footer, 'copyright'),
        feedback: str(footer, 'feedback'),
      },
      security: {
        is_close: bool(security, 'is_close'),
        close_statement: str(security, 'close_statement'),
        enable_register: bool(security, 'enable_register'),
        enable_captcha_login: bool(security, 'enable_captcha_login'),
        enable_captcha_register: bool(security, 'enable_captcha_register'),
        enable_captcha_comment: bool(security, 'enable_captcha_comment'),
        enable_captcha_find_password: bool(security, 'enable_captcha_find_password'),
        enable_captcha_upload: bool(security, 'enable_captcha_upload'),
        max_document_size: int(security, 'max_document_size'),
        document_allowed_ext: list(security, 'document_allowed_ext'),
        login_required: bool(security, 'login_required'),
        enable_verify_register_email: bool(security, 'enable_verify_register_email'),
      },
      display: {
        show_register_user_count: bool(display, 'show_register_user_count'),
        show_index_categories: bool(display, 'show_index_categories'),
        pages_per_read: int(display, 'pages_per_read'),
        copyright_statement: str(display, 'copyright_statement'),
        show_document_descriptions: bool(display, 'show_document_descriptions'),
        hide_keywords_on_lists: bool(display, 'hide_keywords_on_lists'),
        show_document_count: bool(display, 'show_document_count'),
        show_document_view_count: bool(display, 'show_document_view_count'),
        show_document_download_count: bool(display, 'show_document_download_count'),
        show_document_favorite_count: bool(display, 'show_document_favorite_count'),
        hide_category_without_document: bool(display, 'hide_category_without_document'),
        wechat_tip: str(display, 'wechat_tip'),
        wechat_qrcode: str(display, 'wechat_qrcode'),
        contact_tip: str(display, 'contact_tip'),
        contact_link: str(display, 'contact_link'),
        index_document_style: str(display, 'index_document_style'),
        home_version: str(display, 'home_version'),
      },
      download: {
        enable_guest_download: bool(download, 'enable_guest_download'),
        enable_code_download: bool(download, 'enable_code_download'),
        max_price: int(download, 'max_price'),
        code_tip: str(download, 'code_tip'),
        times_every_day: int(download, 'times_every_day'),
        times_every_ip: int(download, 'times_every_ip'),
        free_download_duration: int(download, 'free_download_duration'),
        url_duration: int(download, 'url_duration'),
      },
      language: langs,
    };
  }

  @RequirePermission('/api.v1.ConfigAPI/ListConfig')
  @Get('config/list')
  async listConfig(@Query() query: ListConfigQuery) {
    const categories = this.normalizeArray(query?.category);
    const configs = categories.length
      ? await this.configRepo.find({
          where: { category: In(categories) },
          order: { sort: 'ASC' },
        })
      : await this.configRepo.find({ order: { sort: 'ASC' } });

    return {
      config: configs.map((cfg) => this.toConfigDto(cfg)),
    };
  }

  @RequirePermission('/api.v1.ConfigAPI/UpdateConfig')
  @Put('config')
  async updateConfig(@Body() body: UpdateConfigBody) {
    const configs = (body?.config ?? []).filter(Boolean);
    for (const cfg of configs) {
      if (cfg.category === 'release') {
        throw Biz.permissionDenied('不允许修改此类配置！');
      }
      if (cfg.value === '******') {
        const exist = await this.configRepo.findOne({
          where: { name: cfg.name, category: cfg.category },
        });
        cfg.value = exist?.value ?? '';
      }
    }

    for (const cfg of configs) {
      if (!cfg.id) continue;
      await this.configRepo.update(
        { id: cfg.id },
        { value: cfg.value ?? '', updated_at: new Date() },
      );
    }

    await this.configService.reload();
    return {};
  }

  @Get('release')
  async getLatestRelease() {
    return this.buildReleaseDto();
  }

  @RequirePermission('/api.v1.ConfigAPI/UpdateConfig')
  @Post('release')
  async refreshLatestRelease() {
    const info = await this.getReleaseInfo();
    const source = info['source'] || 'auto';
    const urls: string[] = [];
    if (source === 'gitee') {
      urls.push('https://gitee.com/api/v5/repos/mnt-ltd/moredoc/releases/latest');
    } else if (source === 'github') {
      urls.push('https://api.github.com/repos/mnt-ltd/moredoc/releases/latest');
    } else if (source === 'auto') {
      urls.push('https://gitee.com/api/v5/repos/mnt-ltd/moredoc/releases/latest');
      urls.push('https://api.github.com/repos/mnt-ltd/moredoc/releases/latest');
    } else {
      throw Biz.internal('您未指定新版本检测来源，无法获取最新版本更新！');
    }

    let release: Record<string, string> | null = null;
    let lastErr = '';
    for (const url of urls) {
      try {
        release = await this.fetchLatestRelease(url);
        if (release?.['tag_name']) break;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }
    if (!release?.['tag_name']) {
      throw Biz.internal(lastErr || '获取最新版本更新失败！');
    }

    await this.saveRelease(release);
    return this.buildReleaseDto();
  }

  @RequirePermission('/api.v1.ConfigAPI/UpdateConfig')
  @Put('release/ignore')
  async ignoreRelease(@Body() body: { tag_name?: string }) {
    await this.setReleaseConfigValue('ignore', body?.tag_name ?? '');
    return {};
  }

  @RequirePermission('/api.v1.ConfigAPI/UpdateConfig')
  @Put('release/source')
  async setReleaseSource(@Body() body: { source?: string }) {
    await this.setReleaseConfigValue('source', body?.source ?? '');
    return {};
  }

  @Public()
  @Get('stats')
  async getStats(@CurrentUser() user?: JwtUser) {
    const [userCount, documentCount, articleCount] = await Promise.all([
      this.userRepo.count(),
      this.documentRepo.count(),
      this.articleRepo.count(),
    ]);

    const virtualRow = await this.configRepo.findOne({
      where: { category: 'display', name: 'virtual_register_count' },
    });
    const virtualCount = parseInt(virtualRow?.value ?? '0', 10) || 0;

    let categoryCount = 0;
    let commentCount = 0;
    let bannerCount = 0;
    let friendlinkCount = 0;
    let reportCount = 0;
    if (await this.hasAccess(user, '/api.v1.ConfigAPI/GetStats')) {
      [categoryCount, commentCount, bannerCount, friendlinkCount, reportCount] =
        await Promise.all([
          this.categoryRepo.count(),
          this.commentRepo.count(),
          this.bannerRepo.count(),
          this.friendlinkRepo.count(),
          this.reportRepo.count(),
        ]);
    }

    return {
      user_count: userCount + virtualCount,
      document_count: documentCount,
      category_count: categoryCount,
      article_count: articleCount,
      comment_count: commentCount,
      banner_count: bannerCount,
      friendlink_count: friendlinkCount,
      report_count: reportCount,
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      version: APP_VERSION,
      hash: APP_HASH,
      build_at: APP_BUILD_AT,
    };
  }

  @Get('envs')
  async getEnvs(@CurrentUser() user?: JwtUser) {
    if (!(await this.hasAccess(user, '/api.v1.ConfigAPI/GetEnvs'))) {
      return { envs: [] };
    }

    const envs = [
      {
        name: 'LibreOffice',
        description: 'LibreOffice是由文档基金会开发的自由及开放源代码的办公套件。用于将office等文档转为pdf。',
        cmd: 'soffice',
        is_required: true,
      },
      {
        name: 'Calibre',
        description: 'calibre是一个自由开源的电子书软件套装。用于将epub、mobi等电子书转为pdf。',
        cmd: 'ebook-convert',
        is_required: true,
      },
      {
        name: 'MuPDF',
        description: 'MuPDF是一款以C语言编写的自由及开放源代码软件库，是PDF和XPS解析和渲染引擎。用于将PDF转为svg、png等图片。',
        cmd: 'mutool',
        is_required: false,
      },
      {
        name: 'SVGO',
        description: 'SVGO 是一个基于 Node.js 的工具，用于优化 SVG 矢量图形文件。魔豆文库用于压缩svg图片大小。',
        cmd: 'svgo',
        is_required: false,
      },
      {
        name: 'Inkscape',
        description: 'Inkscape是一个自由开源的矢量图形编辑器。在mupdf处理PDF出现兼容问题失败时，自动切换inkscape来处理。',
        cmd: 'inkscape',
        is_required: false,
      },
    ];

    return {
      envs: envs.map((env) => {
        const is_installed = this.commandExists(env.cmd);
        return {
          name: env.name,
          description: env.description,
          is_installed,
          cmd: env.cmd,
          is_required: env.is_required,
          version: is_installed ? this.getCommandVersion(env.cmd) : '',
        };
      }),
    };
  }

  @RequirePermission('/api.v1.ConfigAPI/UpdateSitemap')
  @Put('sitemap')
  async updateSitemap() {
    const domain = (await this.getConfigValue('system', 'domain')).replace(/\/+$/, '');
    const limit = 10000;
    const indexes: Array<{ loc: string; lastmod: string }> = [];

    let page = 1;
    // 文档站点地图
    for (;;) {
      const documents = await this.documentRepo.find({
        select: ['id', 'updated_at', 'uuid'],
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
      }));
      this.writeFile(file, this.buildSitemapXml(urls));
      indexes.push({ loc: `${domain}/${file}`, lastmod: now });
      page++;
    }

    page = 1;
    // 文章站点地图
    for (;;) {
      const articles = await this.articleRepo.find({
        select: ['id', 'updated_at', 'identifier'],
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
      }));
      this.writeFile(file, this.buildSitemapXml(urls));
      indexes.push({ loc: `${domain}/${file}`, lastmod: now });
      page++;
    }

    if (indexes.length > 0) {
      this.writeFile('sitemap/sitemap.xml', this.buildSitemapIndexXml(indexes));
    }
    return {};
  }

  @RequirePermission('/api.v1.ConfigAPI/GetDeviceInfo')
  @Get('device')
  getDeviceInfo() {
    const cpus = os.cpus();
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;

    return {
      cpu: {
        cores: cpus.length,
        model_name: cpus[0]?.model ?? '',
        mhz: cpus[0]?.speed ?? 0,
        percent: 0,
      },
      memory: {
        total,
        available: free,
        used,
        free,
        percent: total > 0 ? (used / total) * 100 : 0,
      },
      disk: this.getDisk(),
    };
  }

  @RequirePermission('/api.v1.ConfigAPI/SetSQLMode')
  @Put('sqlmode')
  async setSQLMode() {
    await this.dataSource.query(
      "SET GLOBAL sql_mode = (SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))",
    );
    return {};
  }

  private async hasAccess(user: JwtUser | undefined, method: string): Promise<boolean> {
    if (!user) return false;
    return this.permissionService.check(user.userId, method);
  }

  private async getReleaseInfo(): Promise<Record<string, string>> {
    const rows = await this.configRepo.find({ where: { category: 'release' } });
    const map: Record<string, string> = {};
    for (const row of rows) map[row.name] = row.value ?? '';
    return map;
  }

  private async buildReleaseDto() {
    const map = await this.getReleaseInfo();
    return {
      tag_name: map['tag_name'] || APP_VERSION,
      name: map['name'] ?? '',
      body: map['body'] ?? '',
      source: map['source'] ?? 'auto',
      ignore: map['ignore'] ?? '',
      release_at: map['release_at'] ?? '',
      current: APP_VERSION,
    };
  }

  private async setReleaseConfigValue(name: string, value: string) {
    const rows = await this.configRepo.find({ where: { category: 'release', name } });
    if (rows.length === 0) return;
    await this.configRepo.update(
      { category: 'release', name },
      { value, updated_at: new Date() },
    );
  }

  private async saveRelease(release: Record<string, string>) {
    const updates: Array<{ name: string; value: string }> = [];
    if (release['tag_name']) updates.push({ name: 'tag_name', value: release['tag_name'] });
    if (release['name']) updates.push({ name: 'name', value: release['name'] });
    if (release['body']) updates.push({ name: 'body', value: release['body'] });
    const releaseAt = release['published_at'] || release['created_at'];
    if (releaseAt) {
      const d = new Date(releaseAt);
      if (!Number.isNaN(d.getTime())) {
        updates.push({
          name: 'release_at',
          value: d.toISOString().slice(0, 19).replace('T', ' '),
        });
      }
    }

    for (const u of updates) {
      const exist = await this.configRepo.findOne({
        where: { category: 'release', name: u.name },
      });
      if (!exist) continue;
      await this.configRepo.update({ id: exist.id }, { value: u.value, updated_at: new Date() });
    }
  }

  private async fetchLatestRelease(url: string): Promise<Record<string, string>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'moredoc' },
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return (await resp.json()) as Record<string, string>;
    } finally {
      clearTimeout(timer);
    }
  }

  private async getConfigValue(category: string, name: string): Promise<string> {
    const row = await this.configRepo.findOne({ where: { category, name } });
    return row?.value ?? '';
  }

  private normalizeArray(value: string | string[] | undefined): string[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? value.map(String) : [String(value)];
  }

  private toConfigDto(cfg: Config) {
    return {
      id: cfg.id,
      label: cfg.label,
      name: cfg.name,
      value: cfg.is_secret && cfg.value ? '******' : cfg.value,
      placeholder: cfg.placeholder,
      input_type: cfg.input_type,
      category: cfg.category,
      sort: cfg.sort,
      options: cfg.options,
      created_at: cfg.created_at,
      updated_at: cfg.updated_at,
      col_num: cfg.col_num,
    };
  }

  private commandExists(cmd: string): boolean {
    try {
      execSync(`command -v "${cmd}"`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private getCommandVersion(cmd: string): string {
    for (const arg of ['--version', '-version', '-v']) {
      try {
        const out = execSync(`"${cmd}" ${arg} 2>&1`, {
          encoding: 'utf8',
          timeout: 5000,
        }).trim();
        if (out) return out.split('\n')[0].trim();
      } catch {
        // 尝试下一种参数形式
      }
    }
    return '';
  }

  private getDisk(): Array<Record<string, unknown>> {
    try {
      // 使用 -P 强制 POSIX 输出（6 列），避免 macOS 默认多列格式导致挂载点解析错位
      const out = execSync('df -kP', { encoding: 'utf8' });
      const lines = out.trim().split('\n').slice(1);
      const disks: Array<Record<string, unknown>> = [];
      const seenTotals = new Set<number>();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) continue;
        const filesystem = parts[0];
        // 仅保留真实块设备（/dev/xxx），过滤 devfs、tmpfs、map、proc、sysfs 等虚拟/内存文件系统
        if (!filesystem.startsWith('/dev/')) continue;
        const total = parseInt(parts[1], 10);
        const used = parseInt(parts[2], 10);
        const free = parseInt(parts[3], 10);
        const percent = parseFloat(parts[4]);
        if (Number.isNaN(total) || total <= 0) continue;
        // macOS APFS 会把同一物理磁盘挂载为多个卷（total 一致），按容量去重，避免重复展示
        if (seenTotals.has(total)) continue;
        seenTotals.add(total);
        disks.push({
          disk_name: parts.slice(5).join(' '),
          total: total * 1024,
          used: used * 1024,
          free: free * 1024,
          percent: Number.isNaN(percent) ? 0 : percent,
        });
      }
      return disks;
    } catch {
      return [];
    }
  }

  private writeFile(relativePath: string, content: string) {
    const fullPath = path.resolve(process.cwd(), relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  private buildSitemapXml(
    urls: Array<{ loc: string; lastmod: string }>,
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
        '    <changefreq>daily</changefreq>',
        '    <priority>1.0</priority>',
        '  </url>',
      );
    }
    lines.push('</urlset>');
    return lines.join('\n');
  }

  private buildSitemapIndexXml(
    indexes: Array<{ loc: string; lastmod: string }>,
  ): string {
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