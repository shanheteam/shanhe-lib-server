import * as crypto from 'crypto';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

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

/**
 * 与原版 github.com/alexandrevicenzi/unchained 的 md5 哈希保持一致：
 * 存储格式为 `md5$<salt>$<hash>`，其中 hash = md5(salt + password) 的十六进制。
 */
export function makePassword(rawPassword: string, salt = randomString(4), algorithm = 'md5'): string {
  if (algorithm !== 'md5') {
    throw new Error(`unsupported password algorithm: ${algorithm}`);
  }
  const hash = md5hex(salt + rawPassword);
  return `${algorithm}$${salt}$${hash}`;
}

export function checkPassword(rawPassword: string, encoded: string): boolean {
  if (!encoded) return false;
  const parts = encoded.split('$');
  if (parts.length !== 3) return false;
  const [algorithm, salt] = parts;
  return makePassword(rawPassword, salt, algorithm) === encoded;
}