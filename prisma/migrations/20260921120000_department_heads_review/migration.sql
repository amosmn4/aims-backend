-- Who decides on a person's own report and a project's progress report.
-- Off (the default) sends everything to the CEO, which is where AIMS starts.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_settings'
      AND COLUMN_NAME = 'department_heads_review') = 0,
  'ALTER TABLE `company_settings` ADD COLUMN `department_heads_review` BOOLEAN NOT NULL DEFAULT false',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
