import { Controller, Get, Put, Post, Body, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
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
import { RequireRoot } from '../../common/decorators/root.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Biz } from '../../common/biz.exception';
import { PermissionService } from '../../auth/permission.service';
import { ConfigService } from '../../config/config.service';
import { MailService } from '../mail/mail.service';
import { assertSafeOutboundUrl } from '../../common/url-guard.util';
import { JwtUser } from '../../auth/jwt-user.type';
import { ReleaseService } from './split/release.service';
import { SitemapService } from './split/sitemap.service';
import { StatsService } from './split/stats.service';
import { SystemService } from './split/system.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: APP_VERSION } = require('../../../package.json');
const APP_HASH = process.env.MOREDOC_GIT_HASH || '';
const APP_BUILD_AT = process.env.MOREDOC_BUILD_AT || '';

interface ListConfigQuery {
  category?: string | string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 后台"检测邮箱"允许用表单值覆盖的 email 配置项 */
const EMAIL_TEST_FIELDS = [
  'host',
  'port',
  'is_tls',
  'from_name',
  'username',
  'password',
];

interface UpdateConfigBody {
  config?: Array<{ id?: number; name?: string; value?: string; category?: string }>;
}

@Controller()
export class ConfigController {
  private readonly releaseSvc: ReleaseService;
  private readonly sitemapSvc: SitemapService;
  private readonly statsSvc: StatsService;
  private readonly systemSvc: SystemService;

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
    private readonly mailService: MailService,
    private readonly dataSource: DataSource,
  ) {
    this.releaseSvc = new ReleaseService(this.configRepo, APP_VERSION);
    this.sitemapSvc = new SitemapService(
      this.documentRepo,
      this.articleRepo,
      this.categoryRepo,
      this.configRepo,
    );
    this.statsSvc = new StatsService(
      this.userRepo,
      this.documentRepo,
      this.articleRepo,
      this.categoryRepo,
      this.commentRepo,
      this.bannerRepo,
      this.friendlinkRepo,
      this.reportRepo,
      this.configService,
      this.permissionService,
      APP_VERSION,
      APP_HASH,
      APP_BUILD_AT,
    );
    this.systemSvc = new SystemService(this.dataSource);

    // 定时自动重建 sitemap：启动 5 分钟后首次生成，之后每天生成一次（兜底，手动按钮仍可用）
    setTimeout(() => {
      this.sitemapSvc.updateSitemap().catch((err) =>
        console.error('[sitemap] auto rebuild failed', err),
      );
    }, 5 * 60 * 1000);
    setInterval(() => {
      this.sitemapSvc.updateSitemap().catch((err) =>
        console.error('[sitemap] auto rebuild failed', err),
      );
    }, 24 * 3600 * 1000);
  }

  @Public()
  @Get('settings')
  async getSettings() {
    // 直接复用 ConfigService 的内存缓存（启动时全量加载、后台保存配置后自动重载）
    const byCategory = (category: string): Record<string, string> =>
      this.configService.getCategory(category);

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
      select: { id: true, language: true, code: true },
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

    // email 分类变更且填写了测试邮箱时，保存后自动发一封测试邮件，
    // 让管理员在保存时就能确认配置是否可用（失败不影响保存结果，只回传原因）
    const emailChanged = configs.some((cfg) => cfg.category === 'email');
    const testEmail = this.configService.get('email', 'test_email').trim();
    if (
      emailChanged &&
      testEmail &&
      this.configService.getBool('email', 'enable')
    ) {
      const mail = this.buildTestMail();
      try {
        await this.mailService.send(testEmail, mail.subject, mail.html);
        return {
          email_test: {
            success: true,
            message: `已向测试邮箱 ${testEmail} 发送测试邮件，请查收`,
          },
        };
      } catch (err: any) {
        return {
          email_test: {
            success: false,
            message: `测试邮件发送失败：${err?.message || String(err)}`,
          },
        };
      }
    }

    return {};
  }

  /** 测试邮件内容（检测邮箱与保存配置两处共用） */
  private buildTestMail(): { subject: string; html: string } {
    const title = this.configService.get('system', 'title') || '本站';
    return {
      subject: `【${title}】邮件服务测试`,
      html: `<p>这是一封来自【${title}】的测试邮件。</p><p>收到本邮件说明邮件服务配置可用，发送时间：${new Date().toLocaleString('zh-CN')}。</p>`,
    };
  }

  @Public()
  @Get('release')
  async getLatestRelease() {
    return this.releaseSvc.getLatestRelease();
  }

  @RequirePermission('/api.v1.ConfigAPI/UpdateConfig')
  @Post('release')
  async refreshLatestRelease() {
    return this.releaseSvc.refreshLatestRelease();
  }

  @RequirePermission('/api.v1.ConfigAPI/UpdateConfig')
  @Put('release/ignore')
  async ignoreRelease(@Body() body: { tag_name?: string }) {
    return this.releaseSvc.ignoreRelease(body);
  }

  @RequirePermission('/api.v1.ConfigAPI/UpdateConfig')
  @Put('release/source')
  async setReleaseSource(@Body() body: { source?: string }) {
    return this.releaseSvc.setReleaseSource(body);
  }

  @Public()
  @Get('stats')
  async getStats(@CurrentUser() user?: JwtUser) {
    return this.statsSvc.getStats(user);
  }

  @RequireRoot()
  @Get('envs')
  async getEnvs() {
    return this.systemSvc.getEnvs();
  }

  @RequirePermission('/api.v1.ConfigAPI/UpdateSitemap')
  @Put('sitemap')
  async updateSitemap() {
    return this.sitemapSvc.updateSitemap();
  }

  @RequireRoot()
  @RequirePermission('/api.v1.ConfigAPI/GetDeviceInfo')
  @Get('device')
  getDeviceInfo() {
    return this.systemSvc.getDeviceInfo();
  }

  @RequireRoot()
  @RequirePermission('/api.v1.ConfigAPI/SetSQLMode')
  @Put('sqlmode')
  async setSQLMode() {
    return this.systemSvc.setSQLMode();
  }

  @RequireRoot()
  @RequirePermission('/api.v1.ConfigAPI/UpdateConfig')
  @Post('config/oauth-test')
  async testOauthConfig(@Body() body: { url: string; method?: string; data?: any; params?: any }) {
    const { url, method = 'get', data, params } = body;
    if (!url) return { status: 0, message: 'url is required' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      // 阻断 SSRF：该接口由后台传入任意 URL 并回显响应内容
      await assertSafeOutboundUrl(url);
      const opts: RequestInit = {
        method: method.toUpperCase(),
        signal: controller.signal,
        headers: { 'User-Agent': 'moredoc' },
      };
      if (data && method.toLowerCase() !== 'get') {
        opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(data);
      }
      const fullUrl = params
        ? `${url}?${new URLSearchParams(params).toString()}`
        : url;
      const resp = await fetch(fullUrl, opts);
      const text = await resp.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* not json */ }
      return {
        status: resp.status,
        statusText: resp.statusText,
        body: json ?? text,
      };
    } catch (err: any) {
      return {
        status: 0,
        message: err?.message || String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 检测邮箱：用表单里的最新值（未修改的密码项沿用已保存值）校验 SMTP 连接与账号密码，
   * 填写了测试邮箱时再真实投递一封测试邮件。
   */
  @RequireRoot()
  @RequirePermission('/api.v1.ConfigAPI/UpdateConfig')
  @Post('config/email-test')
  async testEmailConfig(
    @Body()
    body: {
      test_email?: string;
      config?: Array<{ name?: string; value?: string; category?: string }>;
    },
  ) {
    const overrides: Record<string, string> = {};
    for (const item of body?.config ?? []) {
      const name = String(item?.name ?? '');
      if (!EMAIL_TEST_FIELDS.includes(name)) continue;
      const value = item?.value ?? '';
      // 密码未修改时前端会回传掩码，此时沿用数据库里已保存的值
      if (name === 'password' && value === '******') continue;
      overrides[name] = value;
    }

    const to = String(body?.test_email ?? '').trim();
    const startedAt = Date.now();
    try {
      const cfg = await this.mailService.verify(overrides);
      if (!to) {
        return {
          status: 200,
          cost: Date.now() - startedAt,
          message: `SMTP 连接与账号密码校验通过（${cfg.host}:${cfg.port}）。如需确认能否收信，请填写测试邮箱后再检测。`,
        };
      }
      if (!EMAIL_RE.test(to)) {
        return { status: 0, message: `测试邮箱格式不正确：${to}` };
      }
      const mail = this.buildTestMail();
      await this.mailService.send(to, mail.subject, mail.html, overrides);
      return {
        status: 200,
        cost: Date.now() - startedAt,
        message: `测试邮件已发送至 ${to}，请查收（若未收到请检查垃圾邮件箱）`,
      };
    } catch (err: any) {
      return {
        status: 0,
        cost: Date.now() - startedAt,
        message: err?.message || String(err),
      };
    }
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
}