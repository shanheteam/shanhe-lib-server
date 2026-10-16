import { Repository } from 'typeorm';
import { Config } from '../../../entities';
import { Biz } from '../../../common/biz.exception';

/** 从 config.controller.ts 拆分出的版本检测子服务 */
export class ReleaseService {
  constructor(
    private readonly configRepo: Repository<Config>,
    private readonly version: string,
  ) {}

  /** GET /release：返回缓存的发布信息 */
  async buildReleaseDto() {
    const map = await this.getReleaseInfo();
    return {
      tag_name: map['tag_name'] || this.version,
      name: map['name'] ?? '',
      body: map['body'] ?? '',
      source: map['source'] ?? 'auto',
      ignore: map['ignore'] ?? '',
      release_at: map['release_at'] ?? '',
      current: this.version,
    };
  }

  /** GET /release：查询已保存的发布配置（对外入口，保持原签名） */
  async getLatestRelease() {
    return this.buildReleaseDto();
  }

  /** POST /release：刷新并保存最新版本信息 */
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

  /** PUT /release/ignore */
  async ignoreRelease(body: { tag_name?: string }) {
    await this.setReleaseConfigValue('ignore', body?.tag_name ?? '');
    return {};
  }

  /** PUT /release/source */
  async setReleaseSource(body: { source?: string }) {
    await this.setReleaseConfigValue('source', body?.source ?? '');
    return {};
  }

  private async getReleaseInfo(): Promise<Record<string, string>> {
    const rows = await this.configRepo.find({ where: { category: 'release' } });
    const map: Record<string, string> = {};
    for (const row of rows) map[row.name] = row.value ?? '';
    return map;
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
}