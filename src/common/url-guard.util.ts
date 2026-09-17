import { lookup } from 'dns/promises';
import * as net from 'net';

/**
 * 出站请求地址校验，用于阻断 SSRF：仅允许 http/https，且目标解析后的 IP
 * 不能落在回环、内网、链路本地（含云元数据 169.254.169.254）等地址段。
 */

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v === '::' || v === '::1') return true;
  // IPv4 映射地址（::ffff:127.0.0.1）按 IPv4 规则判断
  const mapped = v.match(/^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return (
    v.startsWith('fc') ||
    v.startsWith('fd') ||
    v.startsWith('fe8') ||
    v.startsWith('fe9') ||
    v.startsWith('fea') ||
    v.startsWith('feb')
  );
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  // 无法识别的地址一律视为不安全
  return true;
}

/**
 * 校验出站 URL 是否安全。不安全时抛出 Error（含中文提示，可直接透出给调用方）。
 * @param allowPrivate 允许访问内网（如采集内网文库时可按需开启）
 */
export async function assertSafeOutboundUrl(
  rawUrl: string,
  allowPrivate = false,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('URL 格式不正确');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅支持 http/https 协议');
  }
  if (allowPrivate) return url;

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await lookup(hostname, { all: true })).map((r) => r.address);
    } catch {
      throw new Error('无法解析目标域名');
    }
  }
  if (!addresses.length) throw new Error('无法解析目标域名');
  if (addresses.some(isPrivateIp)) {
    throw new Error('禁止访问内网/回环地址');
  }
  return url;
}