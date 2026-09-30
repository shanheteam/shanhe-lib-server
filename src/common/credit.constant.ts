/**
 * 积分/货币展示名的兜底默认值。
 * 站点实际展示名以后台配置 `score.credit_name` 为准，未配置或配置为空时回退到此处。
 * 前端对应 client/src/utils/credit.ts 的 DEFAULT_CREDIT_NAME，两边必须保持一致，
 * 避免配置缺失时前后端显示成两个不同的名字。
 */
export const DEFAULT_CREDIT_NAME = '金币';
