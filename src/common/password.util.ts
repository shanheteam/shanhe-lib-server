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

/** 生成密码哈希，新密码一律使用 bcrypt（格式 `$2a$...`）。 */
export function makePassword(rawPassword: string): string {
  return bcrypt.hashSync(rawPassword, BCRYPT_ROUNDS);
}

/**
 * 校验密码。兼容原版 github.com/alexandrevicenzi/unchained 的存量格式
 * `md5$<salt>$<hash>`（hash = md5(salt + password)），新格式为 bcrypt。
 */
export function checkPassword(rawPassword: string, encoded: string): boolean {
  if (!encoded) return false;

  if (encoded.startsWith('$2')) {
    try {
      return bcrypt.compareSync(rawPassword, encoded);
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