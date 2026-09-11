import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Config } from '../entities';

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

  getBool(category: string, name: string, def = false): boolean {
    const v = this.get(category, name, '');
    if (v === '') return def;
    return v === 'true' || v === '1';
  }

  getInt(category: string, name: string, def = 0): number {
    const v = parseInt(this.get(category, name, ''), 10);
    return Number.isNaN(v) ? def : v;
  }
}