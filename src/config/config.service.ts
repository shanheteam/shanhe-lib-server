import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Config } from '../entities';
import { DEFAULT_CREDIT_NAME } from '../common/credit.constant';
import { env } from './env';

/**
 * 系统配置服务：从 config 表加载全部配置项并在内存中缓存，
 * 提供 get / getBool / getInt 读取接口。
 */
@Injectable()
export class ConfigService implements OnModuleInit {
  private cache = new Map<string, string>();

  constructor(
    @InjectRepository(Config)
    private readonly configRepo: Repository<Config>,
  ) {}

  async onModuleInit() {
    await this.reload();
  }

  async reload(): Promise<void> {
    const rows = await this.configRepo.find();
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(`${row.category}.${row.name}`, row.value ?? '');
    }
    this.cache = map;
  }

  private key(category: string, name: string): string {
    return `${category}.${name}`;
  }

  get(category: string, name: string, def = ''): string {
    const v = this.cache.get(this.key(category, name));
    return v === undefined ? def : v;
  }

  /** 取某个分类下的全部配置（name -> value），用于批量读取，避免逐次查库 */
  getCategory(category: string): Record<string, string> {
    const prefix = `${category}.`;
    const map: Record<string, string> = {};
    for (const [k, v] of this.cache) {
      if (k.startsWith(prefix)) map[k.slice(prefix.length)] = v;
    }
    return map;
  }

  getBool(category: string, name: string, def = false): boolean {
    const v = this.get(category, name, '');
    if (v === '') return def;
    return v === 'true' || v === '1';
  }

  getInt(category: string, name: string, def = 0): number {
    const v = parseInt(this.get(category, name, ''), 10);
    return Number.isNaN(v) ? def : v;
  }

  /**
   * 积分/货币展示名。后台可通过 `score.credit_name` 自定义，
   * 未配置或配置为空串时回退到 DEFAULT_CREDIT_NAME，避免文案里出现空白名称。
   */
  getCreditName(): string {
    return this.get('score', 'credit_name', '').trim() || DEFAULT_CREDIT_NAME;
  }

  /**
   * 下载 token 密钥。
   *
   * ⚠️ 安全说明：此前未配置或仍是历史弱默认值 `moredoc` 时**回退到 JWT 登录密钥**，
   * 导致两种 token 同密钥。而下载 token 的载荷只有一个 `ip`（没有 userId，见
   * document.service.ts 的签发处），登录校验又只验签名不看载荷结构 ——
   * 于是拿到任意一个下载链接的人，就能把该 token 当登录凭证使用，且 userId 被解成 NaN
   * （NaN 是真值，会让 `if (!request.user)`、`userId <= 0` 这类判断失效）。
   *
   * 现改为回退到「JWT 密钥 + 固定命名空间后缀」，两个密钥空间互不相通：
   * 下载 token 无法通过登录校验，登录 token 也无法用来伪造下载链接。
   * 仍建议在后台显式配置一个独立的随机密钥（download.secret_key）。
   */
  getDownloadSecret(): string {
    const v = this.get('download', 'secret_key', '').trim();
    return !v || v === 'moredoc' ? `${env.jwt.secret}:download-token` : v;
  }
}