/** 文章状态机（拆分自 article.service.ts） */
export const ArticleStatus = {
  Pending: 0,
  Pass: 1,
  Reject: 2,
} as const;

/** 文章列表/详情的返回列 */
export const ARTICLE_LIST_COLUMNS = [
  'id',
  'identifier',
  'user_id',
  'view_count',
  'favorite_count',
  'comment_count',
  'title',
  'keywords',
  'description',
  'created_at',
  'updated_at',
  'deleted_at',
  'recommend_at',
  'status',
  'reject_reason',
  'source',
  'source_url',
  'is_notice',
];

/** 允许的排序字段白名单 */
export const ALLOWED_ARTICLE_SORT = new Set([
  'id',
  'view_count',
  'favorite_count',
  'comment_count',
  'created_at',
  'updated_at',
  'recommend_at',
]);