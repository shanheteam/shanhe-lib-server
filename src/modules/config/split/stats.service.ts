import * as os from 'os';
import { Repository } from 'typeorm';
import {
  User,
  Document,
  Article,
  Category,
  Comment,
  Banner,
  Friendlink,
  Report,
} from '../../../entities';
import { ConfigService } from '../../../config/config.service';
import { PermissionService } from '../../../auth/permission.service';
import { JwtUser } from '../../../auth/jwt-user.type';

/** /stats 统计缓存有效期（毫秒） */
const STATS_TTL_MS = 30 * 1000;

/** 从 config.controller.ts 拆分出的统计子服务 */
export class StatsService {
  private readonly statsCache = new Map<string, { at: number; value: Record<string, number> }>();

  constructor(
    private readonly userRepo: Repository<User>,
    private readonly documentRepo: Repository<Document>,
    private readonly articleRepo: Repository<Article>,
    private readonly categoryRepo: Repository<Category>,
    private readonly commentRepo: Repository<Comment>,
    private readonly bannerRepo: Repository<Banner>,
    private readonly friendlinkRepo: Repository<Friendlink>,
    private readonly reportRepo: Repository<Report>,
    private readonly configService: ConfigService,
    private readonly permissionService: PermissionService,
    private readonly version: string,
    private readonly hash: string,
    private readonly buildAt: string,
  ) {}

  /** GET /stats：网站与后台统计数据 */
  async getStats(user?: JwtUser) {
    // 统计数字非强实时，做 30 秒内存缓存，避免每次请求都跑 COUNT(*)
    const base = await this.cachedCounts('base', async () => {
      const [userCount, documentCount, articleCount] = await Promise.all([
        this.userRepo.count(),
        this.documentRepo.count(),
        this.articleRepo.count(),
      ]);
      return { userCount, documentCount, articleCount };
    });

    // 虚拟注册数来自后台配置（内存缓存，保存后立即生效）
    const virtualCount = this.configService.getInt('display', 'virtual_register_count', 0);

    let adminCounts = {
      categoryCount: 0,
      commentCount: 0,
      bannerCount: 0,
      friendlinkCount: 0,
      reportCount: 0,
    };
    if (await this.hasAccess(user, '/api.v1.ConfigAPI/GetStats')) {
      adminCounts = await this.cachedCounts('admin', async () => {
        const [categoryCount, commentCount, bannerCount, friendlinkCount, reportCount] =
          await Promise.all([
            this.categoryRepo.count(),
            this.commentRepo.count(),
            this.bannerRepo.count(),
            this.friendlinkRepo.count(),
            this.reportRepo.count(),
          ]);
        return { categoryCount, commentCount, bannerCount, friendlinkCount, reportCount };
      });
    }

    return {
      user_count: base.userCount + virtualCount,
      document_count: base.documentCount,
      category_count: adminCounts.categoryCount,
      article_count: base.articleCount,
      comment_count: adminCounts.commentCount,
      banner_count: adminCounts.bannerCount,
      friendlink_count: adminCounts.friendlinkCount,
      report_count: adminCounts.reportCount,
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      version: this.version,
      hash: this.hash,
      build_at: this.buildAt,
    };
  }

  private async hasAccess(user: JwtUser | undefined, method: string): Promise<boolean> {
    if (!user) return false;
    return this.permissionService.check(user.userId, method);
  }

  /** 统计数字的短时缓存，key 维度：base（前台可见）/ admin（需权限） */
  private async cachedCounts<T extends Record<string, number>>(
    key: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    const now = Date.now();
    const hit = this.statsCache.get(key);
    if (hit && now - hit.at < STATS_TTL_MS) return hit.value as T;
    const value = await loader();
    this.statsCache.set(key, { at: now, value });
    return value;
  }
}