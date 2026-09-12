import * as crypto from 'crypto';

/** 魔豆文库支持采集下载的文档扩展名 */
export const DOCUMENT_EXTS = new Set([
  'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
  'pdf', 'txt', 'epub', 'mobi', 'wps', 'md', 'rtf',
  'odt', 'pages', 'key', 'numbers', 'csv',
]);

/** 按行拆分规则/关键字，去除空行与首尾空白 */
export function splitLines(raw: string): string[] {
  return String(raw ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 解析 "原字符 => 新字符" 形式的内容替换规则 */
export function parseReplaceRules(raw: string): Array<[string, string]> {
  return splitLines(raw)
    .map((line) => {
      const idx = line.indexOf('=>');
      if (idx < 0) return null;
      return [line.slice(0, idx).trim(), line.slice(idx + 2).trim()] as [string, string];
    })
    .filter((x): x is [string, string] => !!x);
}

/** 判断 URL 是否指向可下载文档，返回小写扩展名（不含点），否则返回空 */
export function documentExtOf(url: string): string {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // 非绝对地址，按原始字符串处理
  }
  const m = pathname.toLowerCase().match(/\.([a-z0-9]{2,8})(?:$|[?#])/);
  if (!m) return '';
  return DOCUMENT_EXTS.has(m[1]) ? m[1] : '';
}

/** 从 URL 文件名推断标题 */
export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return name.replace(/\.[a-z0-9]+$/i, '');
  } catch {
    return '';
  }
}

/** 将级联分类 JSON 字符串（如 "[1,12]"）解析为数字数组 */
export function parseCategoryIds(raw: string): number[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    // 兼容单个 ID
  }
  return [Number(raw)].filter((n) => Number.isInteger(n) && n > 0);
}

export function md5(buf: Buffer | string): string {
  return crypto.createHash('md5').update(buf).digest('hex');
}

/** 生成 16 位文档 uuid（与 DocumentService.genDocumentUUID 风格一致） */
export function genDocumentUuid(): string {
  const rand = String(Math.random()) + String(Date.now());
  return crypto.createHash('md5').update(crypto.randomUUID() + rand).digest('hex').slice(0, 16);
}
