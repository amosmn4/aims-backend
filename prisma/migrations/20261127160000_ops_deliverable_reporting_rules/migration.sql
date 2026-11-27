ALTER TABLE `ops_tasks` ADD COLUMN `requires_deliverables` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `ops_tasks` ALTER COLUMN `requires_deliverables` SET DEFAULT true;
ALTER TABLE `ops_weekly_reports` ADD COLUMN `first_submitted_at` DATETIME(3) NULL;
UPDATE `ops_weekly_reports` SET `first_submitted_at` = `submitted_at` WHERE `submitted_at` IS NOT NULL;
ALTER TABLE `ops_task_delegations`
  ADD COLUMN `deliverable_id` VARCHAR(100) NULL,
  ADD COLUMN `deliverable_title` VARCHAR(200) NULL,
  ADD COLUMN `deliverable_snapshot` TEXT NULL,
  ADD COLUMN `pending_deliverable_key` VARCHAR(140) NULL;
CREATE UNIQUE INDEX `ops_task_delegations_pending_deliverable_key_key` ON `ops_task_delegations`(`pending_deliverable_key`);
