-- =====================================================================
-- 山河图书馆 - 彻底删除「用户名字段」迁移脚本
-- =====================================================================
-- 背景：登录仅使用 email，用户显示统一使用 realname，username 字段已无用。
-- 本脚本负责在执行应用同步表结构(constructor 内 synchronize 或手动执行
-- sync-db) 之前，做好数据准备并正式 DROP username 列。
--
-- 注意：
-- 1) 默认表前缀为 mnt_（表名 mnt_user）。若部署环境配置了不同的 DB_PREFIX，
--    请将文中三处表名统一替换为「你的前缀_user」。
-- 2) 建议先在备份后的数据库上执行，确认无误后再于生产环境执行。
-- 3) 执行可能耗时，请勿在中途中断事务。
-- =====================================================================

START TRANSACTION;

-- ---------------------------------------------------------------------
-- 第 0 步（可选，安全确认）：查看当前 username 是否还有业务依赖
-- 确认应用代码（前端/后端）已不再读写该字段后再执行后续步骤。
-- SELECT COUNT(*) AS remain_username_rows FROM mnt_user WHERE COALESCE(username, '') <> '';
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 第 1 步：回填 realname
-- 规则：realname 为空的使用 email 前缀（@ 前部分）回填，
--       邮箱也缺失的则使用 'user{id}' 回填，保证不产生空值。
-- ---------------------------------------------------------------------
UPDATE mnt_user
   SET realname = CASE
         WHEN email IS NOT NULL AND email <> '' THEN SUBSTRING_INDEX(email, '@', 1)
         ELSE CONCAT('user', id)
       END
 WHERE realname IS NULL OR realname = '';

-- ---------------------------------------------------------------------
-- 第 2 步：保证 email 非空
-- 说明：实体中 email 为唯一索引，历史数据可能存在空邮箱，先补齐。
-- ---------------------------------------------------------------------
UPDATE mnt_user
   SET email = CONCAT('user', id, '@shanhe.local')
 WHERE email IS NULL OR email = '';

-- ---------------------------------------------------------------------
-- 第 3 步：邮箱去重（保留最小 id，其余改为唯一占位邮箱）
-- 说明：email 已设唯一索引，存在重复邮箱会导致同步/建索引失败。
-- 通过窗口函数为每个重复组打上序号，仅保留 id 最小的一行，其余补上
-- 'user{id}@shanhe.local' 作为新的唯一邮箱。
-- ---------------------------------------------------------------------
UPDATE mnt_user u
  JOIN (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY email ORDER BY id ASC) AS rn
      FROM mnt_user
     WHERE email <> ''
  ) t ON t.id = u.id
   SET u.email = CONCAT('user', u.id, '@shanhe.local')
 WHERE t.rn > 1;

-- ---------------------------------------------------------------------
-- 第 4 步：正式 DROP username 列及其索引
-- ---------------------------------------------------------------------
ALTER TABLE mnt_user DROP INDEX IF EXISTS idx_username;

-- MySQL 各版本对列的索引命名存在差异，若上方索引名不匹配，
-- 可改用下面的等价写法（线 5 先查询系统表）：
--   SELECT INDEX_NAME FROM information_schema.STATISTICS
--       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mnt_user'
--         AND COLUMN_NAME = 'username';
--   根据实际索引名替换 idx_username 后再执行 ALTER。

ALTER TABLE mnt_user DROP COLUMN username;

COMMIT;

-- =====================================================================
-- 完成后再执行应用同步以生成 email 唯一索引（如应用已开启 synchronize 则自动完成）：
--   cd server && npm run sync-db
-- 或在应用启动时自动同步即可。
-- =====================================================================