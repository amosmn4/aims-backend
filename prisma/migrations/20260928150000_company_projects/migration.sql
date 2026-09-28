-- Company projects: owned by a lead and team instead of a department.

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_activities' AND COLUMN_NAME = 'is_decision') = 0,
  'ALTER TABLE `project_activities` ADD COLUMN `is_decision` BOOLEAN NOT NULL DEFAULT false',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_activities' AND COLUMN_NAME = 'decided_by') = 0,
  'ALTER TABLE `project_activities` ADD COLUMN `decided_by` CHAR(36) NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_activities' AND COLUMN_NAME = 'decided_at') = 0,
  'ALTER TABLE `project_activities` ADD COLUMN `decided_at` DATETIME(3) NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_team_members' AND COLUMN_NAME = 'access') = 0,
  'ALTER TABLE `project_team_members` ADD COLUMN `access` ENUM(''lead'', ''member'', ''viewer'') NOT NULL DEFAULT ''member''',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'scope') = 0,
  'ALTER TABLE `projects` ADD COLUMN `scope` ENUM(''department'', ''company'') NOT NULL DEFAULT ''department''',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'lead_id') = 0,
  'ALTER TABLE `projects` ADD COLUMN `lead_id` CHAR(36) NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Company projects have no department.
ALTER TABLE `projects` MODIFY `department_id` CHAR(36) NULL;

ALTER TABLE `reports` MODIFY `reviewer_kind` ENUM('ceo', 'department_head', 'project_lead') NOT NULL DEFAULT 'ceo';

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'projects_scope_idx') = 0,
  'CREATE INDEX `projects_scope_idx` ON `projects`(`scope`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'projects_lead_id_idx') = 0,
  'CREATE INDEX `projects_lead_id_idx` ON `projects`(`lead_id`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'
      AND CONSTRAINT_NAME = 'projects_lead_id_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `projects` ADD CONSTRAINT `projects_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
