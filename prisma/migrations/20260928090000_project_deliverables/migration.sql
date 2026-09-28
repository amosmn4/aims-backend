-- Deliverables a project owes its client, logged and ticked off by the owning department.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_deliverables') = 0,
  'CREATE TABLE `project_deliverables` (
     `id` CHAR(36) NOT NULL,
     `project_id` CHAR(36) NOT NULL,
     `title` VARCHAR(191) NOT NULL,
     `description` TEXT NULL,
     `due_date` DATE NULL,
     `status` ENUM(''not_started'', ''in_progress'', ''delivered'') NOT NULL DEFAULT ''not_started'',
     `delivered_at` DATETIME(3) NULL,
     `created_by` CHAR(36) NULL,
     `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     `updated_at` DATETIME(3) NOT NULL,
     INDEX `project_deliverables_project_id_idx`(`project_id`),
     PRIMARY KEY (`id`)
   ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_deliverables'
      AND CONSTRAINT_NAME = 'project_deliverables_project_id_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `project_deliverables` ADD CONSTRAINT `project_deliverables_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
