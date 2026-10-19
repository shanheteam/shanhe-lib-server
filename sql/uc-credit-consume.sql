-- =====================================================================
-- 山河图书馆 - user-center 金币消费流水表（兼幂等表）
-- =====================================================================
-- 背景：user-center 侧消费 lib 金币时，由 user-center 后端带 .shanhe.co 共享
--       access_token cookie 转发调用 lib 的 POST /api/v1/oauth/credit/consume。
--       lib 事务内原子条件扣减 user.credit_count，并把本次消费写入本表；
--       request_id 唯一索引保证重复提交（网络重试/双击）只扣一次。
--
-- 注意：
-- 1) 默认表前缀为 mnt_（表名 mnt_uc_credit_consume）。若部署环境配置了不同的 DB_PREFIX，
--    请将文中 mnt_ 统一替换为「你的前缀_」。
-- 2) 本脚本可重复执行（CREATE TABLE IF NOT EXISTS）。
-- 3) 正常情况下无需手跑：把实体 src/entities/uc-credit-consume.entity.ts 加入
--    src/entities/index.ts 后，执行 `cd server && npm run sync:db` 即会按实体自动建表。
--    本脚本用于不便执行 synchronize 的生产环境。
-- 4) 兼容 MySQL 5.7+。
-- =====================================================================

CREATE TABLE IF NOT EXISTS mnt_uc_credit_consume (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  user_id       BIGINT       NOT NULL                COMMENT 'lib 本地用户 ID',
  uc_sub        VARCHAR(128) NOT NULL DEFAULT ''     COMMENT 'user-center 用户标识（token sub/openid），便于跨系统对账',
  request_id    VARCHAR(64)  NOT NULL                COMMENT '幂等单号，由 user-center 生成，重试复用',
  amount        INT          NOT NULL                COMMENT '扣减额（正整数）',
  reason        VARCHAR(255) NOT NULL DEFAULT ''     COMMENT '消费原因',
  balance_after INT          NOT NULL DEFAULT 0      COMMENT '扣减后余额，幂等命中时原样回放',
  created_at    DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY idx_uc_credit_consume_request_id (request_id),
  KEY idx_uc_credit_consume_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='user-center 金币消费流水（幂等键 request_id）';

-- 回滚（如需）：
-- DROP TABLE IF EXISTS mnt_uc_credit_consume;
