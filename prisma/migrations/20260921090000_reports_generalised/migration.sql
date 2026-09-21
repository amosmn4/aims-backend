-- Generalises department reports into one `reports` table covering departments,
-- projects and people. Renames rather than recreates, so existing rows survive.
--
-- Every step is guarded through information_schema rather than MariaDB's
-- `IF EXISTS` clauses, so this runs on MySQL 5.7+ and MariaDB alike, and is
-- safe to run again if it stops part way through.

-- 1. Rename the tables, only if they still carry the old names.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'department_reports') > 0, "RENAME TABLE `department_reports` TO `reports`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'department_report_messages') > 0, "RENAME TABLE `department_report_messages` TO `report_messages`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Drop the foreign keys that carried the old table's name.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND CONSTRAINT_NAME = 'department_reports_created_by_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0, "ALTER TABLE `reports` DROP FOREIGN KEY `department_reports_created_by_fkey`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND CONSTRAINT_NAME = 'department_reports_department_id_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0, "ALTER TABLE `reports` DROP FOREIGN KEY `department_reports_department_id_fkey`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND CONSTRAINT_NAME = 'department_reports_reviewed_by_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0, "ALTER TABLE `reports` DROP FOREIGN KEY `department_reports_reviewed_by_fkey`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_messages' AND CONSTRAINT_NAME = 'department_report_messages_report_id_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0, "ALTER TABLE `report_messages` DROP FOREIGN KEY `department_report_messages_report_id_fkey`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_messages' AND CONSTRAINT_NAME = 'department_report_messages_author_id_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0, "ALTER TABLE `report_messages` DROP FOREIGN KEY `department_report_messages_author_id_fkey`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_messages' AND CONSTRAINT_NAME = 'department_report_messages_parent_id_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0, "ALTER TABLE `report_messages` DROP FOREIGN KEY `department_report_messages_parent_id_fkey`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. Drop the indexes that carried the old table's name.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'department_reports_department_id_status_idx') > 0, "ALTER TABLE `reports` DROP INDEX `department_reports_department_id_status_idx`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'department_reports_period_end_idx') > 0, "ALTER TABLE `reports` DROP INDEX `department_reports_period_end_idx`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'department_reports_created_by_fkey') > 0, "ALTER TABLE `reports` DROP INDEX `department_reports_created_by_fkey`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'department_reports_reviewed_by_fkey') > 0, "ALTER TABLE `reports` DROP INDEX `department_reports_reviewed_by_fkey`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_messages' AND INDEX_NAME = 'department_report_messages_report_id_created_at_idx') > 0, "ALTER TABLE `report_messages` DROP INDEX `department_report_messages_report_id_created_at_idx`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_messages' AND INDEX_NAME = 'department_report_messages_author_id_fkey') > 0, "ALTER TABLE `report_messages` DROP INDEX `department_report_messages_author_id_fkey`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_messages' AND INDEX_NAME = 'department_report_messages_parent_id_fkey') > 0, "ALTER TABLE `report_messages` DROP INDEX `department_report_messages_parent_id_fkey`", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 4. New columns. `subject_id` is filled in step 5 before it is made NOT NULL.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'kind') = 0, "ALTER TABLE `reports` ADD COLUMN `kind` ENUM(''department'', ''project'', ''individual'') NOT NULL DEFAULT ''department''", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'template') = 0, "ALTER TABLE `reports` ADD COLUMN `template` ENUM(''department_monthly'', ''project_progress'', ''project_completion'', ''individual_period'') NOT NULL DEFAULT ''department_monthly''", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'subject_id') = 0, "ALTER TABLE `reports` ADD COLUMN `subject_id` CHAR(36) NULL", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'subject_user_id') = 0, "ALTER TABLE `reports` ADD COLUMN `subject_user_id` CHAR(36) NULL", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'sections') = 0, "ALTER TABLE `reports` ADD COLUMN `sections` JSON NULL", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'reviewer_kind') = 0, "ALTER TABLE `reports` ADD COLUMN `reviewer_kind` ENUM(''ceo'', ''department_head'') NOT NULL DEFAULT ''ceo''", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'last_review_note') = 0, "ALTER TABLE `reports` ADD COLUMN `last_review_note` TEXT NULL", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'submission_count') = 0, "ALTER TABLE `reports` ADD COLUMN `submission_count` INTEGER NOT NULL DEFAULT 0", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- A report about a project or a person has no owning department of its own.
ALTER TABLE `reports` MODIFY COLUMN `department_id` CHAR(36) NULL;

-- 5. Backfill every existing row as a departmental report.
UPDATE `reports` SET `subject_id` = `department_id` WHERE `subject_id` IS NULL;

-- How many times it was sent, from the messages that recorded each send.
UPDATE `reports` r
SET r.`submission_count` = (
  SELECT COUNT(*) FROM `report_messages` m
  WHERE m.`report_id` = r.`id` AND m.`kind` IN ('submitted', 'resubmitted')
)
WHERE r.`submission_count` = 0;

-- A report already sent but with no recorded message still counts as sent once.
UPDATE `reports`
SET `submission_count` = 1
WHERE `submission_count` = 0 AND `submitted_at` IS NOT NULL;

-- The CEO's last "please change this" note, lifted out of the thread.
UPDATE `reports` r
SET r.`last_review_note` = (
  SELECT m.`body` FROM `report_messages` m
  WHERE m.`report_id` = r.`id` AND m.`kind` = 'changes_requested'
  ORDER BY m.`created_at` DESC
  LIMIT 1
)
WHERE r.`last_review_note` IS NULL;

-- 6. A row with no department cannot become a departmental report. There should
-- be none, but stop rather than write a row that means nothing.
SET @orphans := (SELECT COUNT(*) FROM `reports` WHERE `subject_id` IS NULL);
SET @sql := IF(@orphans > 0, 'SELECT * FROM `migration_stopped_report_with_no_department`', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE `reports` MODIFY COLUMN `subject_id` CHAR(36) NOT NULL;

-- 7. One report per subject per period. Nothing enforced this before, so stop
-- with a readable error rather than a duplicate-key failure if two exist.
SET @dupes := (SELECT COUNT(*) FROM (
  SELECT `kind`, `subject_id`, `period_start`, `period_end`
  FROM `reports` GROUP BY 1, 2, 3, 4 HAVING COUNT(*) > 1
) d);
SET @sql := IF(@dupes > 0, 'SELECT * FROM `migration_stopped_two_reports_for_the_same_period`', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 8. The indexes the new shape needs.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'reports_kind_subject_id_period_start_period_end_key') = 0, "ALTER TABLE `reports` ADD UNIQUE INDEX `reports_kind_subject_id_period_start_period_end_key` (`kind`, `subject_id`, `period_start`, `period_end`)", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'reports_department_id_status_idx') = 0, "ALTER TABLE `reports` ADD INDEX `reports_department_id_status_idx` (`department_id`, `status`)", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'reports_status_period_end_idx') = 0, "ALTER TABLE `reports` ADD INDEX `reports_status_period_end_idx` (`status`, `period_end`)", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'reports_subject_user_id_period_end_idx') = 0, "ALTER TABLE `reports` ADD INDEX `reports_subject_user_id_period_end_idx` (`subject_user_id`, `period_end`)", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'reports_kind_subject_id_idx') = 0, "ALTER TABLE `reports` ADD INDEX `reports_kind_subject_id_idx` (`kind`, `subject_id`)", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'reports_created_by_fkey') = 0, "ALTER TABLE `reports` ADD INDEX `reports_created_by_fkey` (`created_by`)", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'reports_reviewed_by_fkey') = 0, "ALTER TABLE `reports` ADD INDEX `reports_reviewed_by_fkey` (`reviewed_by`)", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'reports_subject_user_id_fkey') = 0, "ALTER TABLE `reports` ADD INDEX `reports_subject_user_id_fkey` (`subject_user_id`)", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_messages' AND INDEX_NAME = 'report_messages_report_id_created_at_idx') = 0, "ALTER TABLE `report_messages` ADD INDEX `report_messages_report_id_created_at_idx` (`report_id`, `created_at`)", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_messages' AND INDEX_NAME = 'report_messages_author_id_fkey') = 0, "ALTER TABLE `report_messages` ADD INDEX `report_messages_author_id_fkey` (`author_id`)", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_messages' AND INDEX_NAME = 'report_messages_parent_id_fkey') = 0, "ALTER TABLE `report_messages` ADD INDEX `report_messages_parent_id_fkey` (`parent_id`)", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 9. Put the foreign keys back under the new names.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND CONSTRAINT_NAME = 'reports_department_id_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0, "ALTER TABLE `reports` ADD CONSTRAINT `reports_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND CONSTRAINT_NAME = 'reports_subject_user_id_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0, "ALTER TABLE `reports` ADD CONSTRAINT `reports_subject_user_id_fkey` FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND CONSTRAINT_NAME = 'reports_created_by_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0, "ALTER TABLE `reports` ADD CONSTRAINT `reports_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND CONSTRAINT_NAME = 'reports_reviewed_by_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0, "ALTER TABLE `reports` ADD CONSTRAINT `reports_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_messages' AND CONSTRAINT_NAME = 'report_messages_report_id_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0, "ALTER TABLE `report_messages` ADD CONSTRAINT `report_messages_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_messages' AND CONSTRAINT_NAME = 'report_messages_author_id_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0, "ALTER TABLE `report_messages` ADD CONSTRAINT `report_messages_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_messages' AND CONSTRAINT_NAME = 'report_messages_parent_id_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0, "ALTER TABLE `report_messages` ADD CONSTRAINT `report_messages_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `report_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
