import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { DataSource } from 'typeorm';

/** 从 config.controller.ts 拆分出的系统信息子服务 */
export class SystemService {
  constructor(private readonly dataSource: DataSource) {}

  /** GET /envs：检测文档转换所需外部命令是否安装 */
  getEnvs() {
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

  /** GET /device：CPU / 内存 / 磁盘信息 */
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

  /** PUT /sqlmode：关闭 ONLY_FULL_GROUP_BY（以兼容旧 SQL） */
  async setSQLMode() {
    await this.dataSource.query(
      "SET GLOBAL sql_mode = (SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))",
    );
    return {};
  }

  private commandExists(cmd: string): boolean {
    try {
      execSync(`command -v "${cmd}"`, { stdio: 'ignore' });
      return true;
    } catch {
      // PATH 中找不到时，回退检查当前项目本地安装的 node_modules/.bin 命令
      const local = path.join(process.cwd(), 'node_modules', '.bin', cmd);
      return fs.existsSync(local);
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
}