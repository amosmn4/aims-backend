ALTER TABLE `ops_module_grants` MODIFY `module` ENUM('water', 'blog', 'ledger', 'inventory', 'tender') NOT NULL;
INSERT IGNORE INTO `ops_module_grants` (`staff_id`, `module`, `access`)
SELECT DISTINCT s.`id`, 'tender', 'manage' FROM `ops_staff` s
WHERE s.`user_id` IS NOT NULL AND (EXISTS (SELECT 1 FROM `tenders` t WHERE t.`account_manager_id` = s.`user_id`) OR EXISTS (SELECT 1 FROM `tender_resources` r WHERE r.`user_id` = s.`user_id`));
ALTER TABLE `ops_clients` ADD COLUMN `assignees` JSON NULL, ADD COLUMN `assigned_dept` VARCHAR(20) NULL, ADD COLUMN `business` VARCHAR(36) NOT NULL DEFAULT 'b0';
ALTER TABLE `ops_projects` ADD COLUMN `business` VARCHAR(36) NOT NULL DEFAULT 'b0';
ALTER TABLE `ops_tasks` MODIFY `project` CHAR(36) NULL, ADD COLUMN `business` VARCHAR(36) NOT NULL DEFAULT 'b0', ADD COLUMN `week_start` CHAR(10) NULL, ADD COLUMN `source` VARCHAR(20) NOT NULL DEFAULT 'project', ADD COLUMN `subtasks` JSON NULL;
ALTER TABLE `ops_reports` ADD COLUMN `month` CHAR(7) NULL, ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'submitted', ADD COLUMN `business` VARCHAR(36) NOT NULL DEFAULT 'b0', ADD COLUMN `task_ids` JSON NULL, ADD COLUMN `task_snapshots` JSON NULL, ADD COLUMN `attachments` JSON NULL, ADD COLUMN `leave_snapshot` JSON NULL;
ALTER TABLE `ops_client_requests` ADD COLUMN `assigned_dept` VARCHAR(20) NULL, ADD COLUMN `business` VARCHAR(36) NOT NULL DEFAULT 'b0';
ALTER TABLE `ops_documents` ADD COLUMN `report` CHAR(36) NULL, ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;
CREATE TABLE `ops_document_versions` (
  `id` CHAR(36) NOT NULL, `document_id` CHAR(36) NOT NULL, `version` INTEGER NOT NULL,
  `name` VARCHAR(200) NOT NULL, `storage_key` VARCHAR(200) NOT NULL, `mime` VARCHAR(200) NOT NULL,
  `size` INTEGER NOT NULL, `uploaded_by` CHAR(36) NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE INDEX `ops_document_versions_document_id_version_key` (`document_id`, `version`),
  CONSTRAINT `ops_document_versions_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `ops_documents` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `ops_document_versions` (`id`, `document_id`, `version`, `name`, `storage_key`, `mime`, `size`, `uploaded_by`)
SELECT UUID(), `id`, 1, `name`, `storage_key`, `mime`, `size`, `owner` FROM `ops_documents`;
CREATE TABLE `ops_leave` (
  `id` CHAR(36) NOT NULL, `staff_id` CHAR(36) NOT NULL, `start` CHAR(10) NOT NULL, `end` CHAR(10) NOT NULL,
  `note` TEXT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `ops_leave_staff_id_start_end_idx` (`staff_id`, `start`, `end`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ops_submission_schedules` (
  `id` CHAR(36) NOT NULL, `staff_id` CHAR(36) NOT NULL, `kind` VARCHAR(20) NOT NULL, `target` VARCHAR(100) NOT NULL,
  `run_at` DATETIME(3) NOT NULL, `status` VARCHAR(20) NOT NULL DEFAULT 'pending', `reminder_state` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `lease_until` DATETIME(3) NULL, `last_error` VARCHAR(500) NULL, `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `ops_submission_schedules_staff_id_kind_target_key` (`staff_id`, `kind`, `target`),
  INDEX `ops_submission_schedules_status_run_at_idx` (`status`, `run_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ops_password_resets` (
  `id` CHAR(36) NOT NULL, `staff_id` CHAR(36) NOT NULL, `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL, `used_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `ops_password_resets_token_hash_key` (`token_hash`), INDEX `ops_password_resets_staff_id_idx` (`staff_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
