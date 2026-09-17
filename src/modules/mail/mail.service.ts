import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '../../config/config.service';

/** 后台 email 分类里可被"保存前测试"覆盖的字段 */
export interface SmtpOverrides {
  host?: string;
  port?: number | string;
  is_tls?: boolean | string;
  from_name?: string;
  username?: string;
  password?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  fromName: string;
  username: string;
  password: string;
}

/**
 * 邮件发送服务：SMTP 参数全部来自后台 email 分类配置（ConfigService 内存缓存）。
 * overrides 用于后台"检测邮箱"时用表单里的未保存值做校验。
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private transportKey = '';

  constructor(private readonly config: ConfigService) {}

  private toBool(v: unknown, def = false): boolean {
    if (v === undefined || v === null || v === '') return def;
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }

  /** 读取 SMTP 配置；overrides 中的字段优先（空字符串视为未覆盖） */
  getSmtpConfig(overrides: SmtpOverrides = {}): SmtpConfig {
    const pick = <T>(value: T, fallback: T): T =>
      value === undefined || value === null || (value as unknown) === ''
        ? fallback
        : value;

    const host = String(
      pick(overrides.host, this.config.get('email', 'host')),
    ).trim();
    const port = Number(
      pick(
        overrides.port,
        this.config.get('email', 'port', '465'),
      ),
    );
    const isTls = this.toBool(
      pick(overrides.is_tls, this.config.get('email', 'is_tls', 'true')),
      true,
    );

    return {
      host,
      port: Number.isFinite(port) && port > 0 ? port : 465,
      secure: isTls, // 465 等隐式 TLS 端口；非 TLS 端口由 nodemailer 自动 STARTTLS
      fromName: String(
        pick(overrides.from_name, this.config.get('email', 'from_name')),
      ).trim(),
      username: String(
        pick(overrides.username, this.config.get('email', 'username')),
      ).trim(),
      password: String(
        pick(overrides.password, this.config.get('email', 'password')),
      ),
    };
  }

  /** 邮件服务是否已可用：已启用 + 配置了服务器地址 + 配置了账号 */
  isConfigured(cfg: SmtpConfig = this.getSmtpConfig()): boolean {
    return !!cfg.host && !!cfg.username;
  }

  private getTransporter(cfg: SmtpConfig): nodemailer.Transporter {
    // 以配置指纹做缓存，后台改配置后自动重建连接池
    const key = [cfg.host, cfg.port, cfg.secure, cfg.username, cfg.password].join(
      '|',
    );
    if (!this.transporter || this.transportKey !== key) {
      this.transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: cfg.username
          ? { user: cfg.username, pass: cfg.password }
          : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
      this.transportKey = key;
    }
    return this.transporter;
  }

  /** 把 nodemailer 的底层错误转成可读提示 */
  private describeError(err: any, cfg: SmtpConfig): string {
    const message = err?.message || String(err);
    switch (err?.code) {
      case 'EAUTH':
        return `SMTP 认证失败，请检查账号与密码：${message}`;
      case 'ECONNECTION':
      case 'ETIMEDOUT':
      case 'ESOCKET':
        return `无法连接 SMTP 服务器 ${cfg.host}:${cfg.port}，请检查地址、端口与网络：${message}`;
      case 'EENVELOPE':
        return `邮件被服务器拒绝，请检查发件账号与收件地址：${message}`;
      default:
        return message;
    }
  }

  private assertConfigured(cfg: SmtpConfig): void {
    if (!cfg.host) throw new Error('未配置 SMTP 服务器地址');
    if (!cfg.username) throw new Error('未配置 SMTP 账号');
  }

  /** 校验 SMTP 连接与账号密码，失败抛出可读异常 */
  async verify(overrides: SmtpOverrides = {}): Promise<SmtpConfig> {
    const cfg = this.getSmtpConfig(overrides);
    this.assertConfigured(cfg);
    try {
      await this.getTransporter(cfg).verify();
    } catch (err: any) {
      throw new Error(this.describeError(err, cfg));
    }
    return cfg;
  }

  /** 发送邮件，失败抛出可读异常 */
  async send(
    to: string,
    subject: string,
    html: string,
    overrides: SmtpOverrides = {},
  ): Promise<void> {
    const cfg = this.getSmtpConfig(overrides);
    this.assertConfigured(cfg);
    const from = cfg.fromName
      ? `"${cfg.fromName}" <${cfg.username}>`
      : cfg.username;
    try {
      await this.getTransporter(cfg).sendMail({ from, to, subject, html });
    } catch (err: any) {
      const message = this.describeError(err, cfg);
      this.logger.error(`发送邮件到 ${to} 失败：${message}`);
      throw new Error(message);
    }
  }
}