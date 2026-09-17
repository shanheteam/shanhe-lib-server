import 'dotenv/config';

export interface EnvConfig {
  isProduction: boolean;
  port: number;
  db: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    prefix: string;
  };
  jwt: {
    secret: string;
    expireDays: number;
  };
  uploadDir: string;
  documentDir: string;
  corsOrigin: string;
  /** 是否信任反向代理（CDN/Nginx）透传的 X-Forwarded-For，影响限流与记录的真实 IP */
  trustProxy: boolean;
}

/** 已知的弱默认密钥，生产环境禁止使用 */
const WEAK_SECRETS = new Set(['', 'moredoc', 'secret', 'jwt', 'changeme', '123456']);

function resolveJwtSecret(): string {
  const secret = (process.env.JWT_SECRET || '').trim();
  const weak = WEAK_SECRETS.has(secret.toLowerCase());
  if (weak) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '生产环境必须通过环境变量 JWT_SECRET 配置强随机密钥（不可使用默认值 moredoc 等弱密钥），已拒绝启动。',
      );
    }
    console.warn('[moredoc] 警告：JWT_SECRET 未配置或为弱密钥，仅可在开发环境使用，生产环境将拒绝启动。');
    return 'moredoc';
  }
  if (secret.length < 16) {
    console.warn('[moredoc] 警告：JWT_SECRET 长度不足 16 位，建议更换为更长的随机密钥。');
  }
  return secret;
}

export const env: EnvConfig = {
  isProduction: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT || '8880', 10),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_DATABASE || 'moredoc',
    prefix: process.env.DB_PREFIX || 'mnt_',
  },
  jwt: {
    secret: resolveJwtSecret(),
    expireDays: parseInt(process.env.JWT_EXPIRE_DAYS || '3650', 10),
  },
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  documentDir: process.env.DOCUMENT_DIR || 'documents',
  corsOrigin: process.env.CORS_ORIGIN || '',
  trustProxy: process.env.TRUST_PROXY === 'true',
};