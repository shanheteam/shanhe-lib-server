import { FindOptionsWhere, Like } from 'typeorm';

/** 将查询参数（字符串、数组或逗号分隔字符串）统一转为字符串数组 */
export function asArray(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .filter((v) => v !== undefined && v !== null && v !== '')
    .map((v) => String(v));
}

export function toNumberArray(value: unknown): number[] {
  return asArray(value)
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n));
}

export function toBoolArray(value: unknown): boolean[] {
  return asArray(value).map((v) => v === 'true' || v === '1');
}

export function toInt(value: unknown, defaultValue = 1): number {
  const arr = asArray(value);
  if (arr.length === 0) return defaultValue;
  const n = Number(arr[0]);
  return Number.isInteger(n) && n > 0 ? n : defaultValue;
}

export function toStringValue(value: unknown): string {
  const arr = asArray(value);
  return arr.length ? arr[0] : '';
}

export function normalizePageSize(
  page: unknown,
  size: unknown,
): { page: number; size: number } {
  const p = toInt(page, 1);
  const s = toInt(size, 10);
  return { page: Math.max(1, p), size: Math.min(Math.max(s, 1), 100) };
}

/** 去除对象中的 undefined 字段（用于 TypeORM update/save） */
export function defined<T extends Record<string, unknown>>(
  obj: T,
  exclude: string[] = [],
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && !exclude.includes(k)) out[k] = v;
  }
  return out as Partial<T>;
}

/** 关键字在多个字段上做 OR LIKE 查询，返回 where 条件数组 */
export function orLike<T>(
  base: FindOptionsWhere<T>,
  columns: string[],
  wd: string,
): FindOptionsWhere<T>[] {
  if (!wd) return [base];
  return columns.map(
    (col) => ({ ...base, [col]: Like(`%${wd}%`) }) as FindOptionsWhere<T>,
  );
}