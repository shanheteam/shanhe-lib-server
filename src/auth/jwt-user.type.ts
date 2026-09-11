/**
 * JWT 载荷（与原版 middleware/auth 的 UserClaims 对齐）。
 */
export interface JwtUser {
  userId: number;
  uuid: string;
  /** 是否已通过权限校验（管理员权限） */
  haveAccess?: boolean;
  /** token 过期时间戳（秒） */
  exp?: number;
}