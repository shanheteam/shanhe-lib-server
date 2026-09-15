-- =====================================================================
-- 山河图书馆 - 彻底删除「用户名字段」迁移脚本
-- =====================================================================
-- 背景：登录仅使用 email，用户显示统一使用 realname，username 字段已无用。
-- 本脚本负责在执行应用同步表结构之前，做好数据准备并正式 DROP username 列。
--
-- 注意：
-- 1) 默认表前缀为 mnt_（表名 mnt_user）。若部署环境配置了不同的 DB_PREFIX，
--    请将文中所有 mnt_user 统一替换为「你的前缀_user」。
-- 2) 建议先在备份后的数据库上执行，确认无误后再于生产环境执行。
-- 3) 兼容 MySQL 5.7+。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 第 0 步：先查一下 username 列上到底有哪些索引，按需删除
-- 执行下面这条，把结果中的索引名记下来，替换到第 4 步。
-- ---------------------------------------------------------------------
-- SELECT INDEX_NAME FROM information_schema.STATISTICS
--     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mnt_user'
--       AND COLUMN_NAME = 'username';

START TRANSACTION;

-- ---------------------------------------------------------------------
-- 第 1 步：回填 realname
-- ---------------------------------------------------------------------
UPDATE mnt_user
   SET realname = CASE
         WHEN email IS NOT NULL AND email <> '' THEN SUBSTRING_INDEX(email, '@', 1)
         ELSE CONCAT('user', id)
       END
 WHERE realname IS NULL OR realname = '';

-- ---------------------------------------------------------------------
-- 第 2 步：保证 email 非空
-- ---------------------------------------------------------------------
UPDATE mnt_user
   SET email = CONCAT('user', id, '@shanhe.local')
 WHERE email IS NULL OR email = '';

-- ---------------------------------------------------------------------
-- 第 3 步：邮箱去重（保留最小 id，其余改为唯一占位邮箱）
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
-- 第 4 步：动态删除 username 列上的所有索引（不存在则跳过）
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _drop_username_indexes;

DELIMITER $$
CREATE PROCEDURE _drop_username_indexes()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE idx_name VARCHAR(128);
  DECLARE cur CURSOR FOR
    SELECT DISTINCT INDEX_NAME
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'mnt_user'
       AND COLUMN_NAME = 'username';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO idx_name;
    IF done THEN LEAVE read_loop; END IF;
    SET @sql = CONCAT('ALTER TABLE mnt_user DROP INDEX `', idx_name, '`');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur;
END$$
DELIMITER ;

CALL _drop_username_indexes();
DROP PROCEDURE _drop_username_indexes;

-- ---------------------------------------------------------------------
-- 第 5 步：正式 DROP username 列
-- ---------------------------------------------------------------------
ALTER TABLE mnt_user DROP COLUMN username;

COMMIT;

-- =====================================================================
-- 完成后再执行应用同步以生成 email 唯一索引：
--   cd server && npm run sync-db
-- =====================================================================
