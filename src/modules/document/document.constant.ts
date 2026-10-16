/** 文档状态机（共用常量，拆分自 document.service.ts） */
export const DocumentStatus = {
  Pending: 0, // 待转换
  Converting: 1, // 转换中
  Converted: 2, // 已转换
  Failed: 3, // 转换失败
  Disabled: 4, // 已禁用
  RePending: 5, // 重新转换
  PendingReview: 6, // 待审核
  ReviewReject: 7, // 审核拒绝
} as const;

export const AttachmentTypeDocument = 2;
export const CategoryTypeDocument = 0;