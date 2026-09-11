import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';
import { env } from '../config/env';

/**
 * 表名统一添加前缀（默认 mnt_），列名默认即属性名（实体属性直接使用 snake_case），
 * 因此无需再做列名的驼峰转换。
 */
export class MoredocNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  tableName(targetName: string, userSpecifiedName: string | undefined): string {
    const base = userSpecifiedName || targetName;
    return env.db.prefix + base;
  }
}

export const tb = (name: string) => env.db.prefix + name;