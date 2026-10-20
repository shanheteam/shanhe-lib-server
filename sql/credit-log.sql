-- =====================================================================
-- 山河图书馆 - 积分配置奖励流水表
-- =====================================================================
-- 用途：记录注册、签到、上传文档、删除文档、文档被收藏、文档被评论
--       产生的积分增减，用于每日次数上限统计与审计对账。
--
-- 注意：
-- 1) 默认表前缀为 mnt_（表名 mnt_credit_log）。若部署环境配置了不同的 DB_PREFIX，
--    请将文中 mnt_ 统一替换为「你的前缀_」。
-- 2) 本脚本可重复执行（CREATE TABLE IF NOT EXISTS）。
-- 3) 正常情况下无需手跑：执行 `cd server && npm run sync:db`
--    即会按实体自动建表。本脚本用于不便执行 synchronize 的生产环境。
-- 4) 兼容 MySQL 5.7+。
-- =====================================================================

CREATE TABLE IF NOT EXISTS mnt_credit_log (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  user_id       BIGINT       NOT NULL DEFAULT 0      COMMENT '积分变动用户 ID',
  type          SMALLINT     NOT NULL DEFAULT 0      COMMENT '1注册 2签到 3上传文档 4删除文档 5文档被收藏 6文档被评论',
  amount        INT          NOT NULL DEFAULT 0      COMMENT '变动额：正数为获得，负数为扣除',
  balance_after INT          NOT NULL DEFAULT 0      COMMENT '变动后积分余额',
  ref_id        BIGINT       NOT NULL DEFAULT 0      COMMENT '关联业务记录 ID（文档 ID、评论 ID 等）',
  remark        VARCHAR(255) NOT NULL DEFAULT ''     COMMENT '流水说明',
  created_at    DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_credit_log_user_type_created (user_id, type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分奖励/扣减流水';

-- 回滚（如需）：
-- DROP TABLE IF EXISTS mnt_credit_log;
