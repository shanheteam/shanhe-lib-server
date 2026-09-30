import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** bcrypt 代价因子，兼顾安全与登录耗时 */
const BCRYPT_ROUNDS = 10;

export function randomString(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += CHARSET.charAt(Math.floor(Math.random() * CHARSET.length));
  }
  return result;
}

function md5hex(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}

/** 定长安全比较，避免比较密码哈希时泄露时序信息 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * 生成密码哈希，新密码一律使用 bcrypt（格式 `$2a$...`）。
 * 用异步 API：bcryptjs 是纯 JS 实现，10 轮同步哈希会阻塞事件循环数十至上百毫秒，
 * 期间所有 HTTP 请求排队（登录、改密、SSO 自动建号都会触发）。哈希结果与同步版完全一致。
 */
export async function makePassword(rawPassword: string): Promise<string> {
  return bcrypt.hash(rawPassword, BCRYPT_ROUNDS);
}

/**
 * 校验密码。兼容原版 github.com/alexandrevicenzi/unchained 的存量格式
 * `md5$<salt>$<hash>`（hash = md5(salt + password)），新格式为 bcrypt。
 * 同 makePassword，bcrypt 分支走异步 API 以免阻塞事件循环。
 */
export async function checkPassword(rawPassword: string, encoded: string): Promise<boolean> {
  if (!encoded) return false;

  if (encoded.startsWith('$2')) {
    try {
      return await bcrypt.compare(rawPassword, encoded);
    } catch {
      return false;
    }
  }

  const parts = encoded.split('$');
  if (parts.length !== 3) return false;
  const [algorithm, salt] = parts;
  if (algorithm !== 'md5') return false;
  return safeEqual(`md5$${salt}$${md5hex(salt + rawPassword)}`, encoded);
}

/** 存量弱哈希（md5）在校验通过后应重新哈希为 bcrypt。 */
export function needsRehash(encoded: string): boolean {
  return !encoded.startsWith('$2');
}