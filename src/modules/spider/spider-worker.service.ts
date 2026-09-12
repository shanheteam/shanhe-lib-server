import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { SpiderCrawlerService } from './spider-crawler.service';

/**
 * 采集调度 worker：每分钟检查一次，按 spider.interval（分钟）配置触发采集引擎。
 */
@Injectable()
export class SpiderWorkerService implements OnModuleInit {
  private readonly logger = new Logger(SpiderWorkerService.name);
  private lastTickAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly crawler: SpiderCrawlerService,
  ) {}

  onModuleInit() {
    setInterval(() => {
      void this.loop();
    }, 60_000);
  }

  private async loop(): Promise<void> {
    if (!this.config.getBool('spider', 'enable', false)) return;
    const intervalMin = Math.max(1, this.config.getInt('spider', 'interval', 5));
    const now = Date.now();
    if (now - this.lastTickAt < intervalMin * 60_000) return;
    this.lastTickAt = now;
    try {
      await this.crawler.tick();
    } catch (e) {
      this.logger.error(`采集调度异常：${(e as Error).message}`);
    }
  }
}
