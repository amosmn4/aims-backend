-- AlterTable
ALTER TABLE `client_requests` ADD COLUMN `stage_changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `hrms_licenses` ADD COLUMN `licensed_seats` INTEGER NULL;

-- AlterTable
ALTER TABLE `inventory_items` ADD COLUMN `assigned_user_id` CHAR(36) NULL,
    ADD COLUMN `department_id` CHAR(36) NULL,
    ADD COLUMN `purchase_cost` DECIMAL(14, 2) NULL,
    ADD COLUMN `useful_life_months` INTEGER NULL;

-- AlterTable
ALTER TABLE `projects` ADD COLUMN `completed_at` DATETIME(3) NULL,
    ADD COLUMN `delivery_stage_changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `tenders` ADD COLUMN `stage_changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `won_reason` TEXT NULL;

-- AlterTable
ALTER TABLE `tickets` ADD COLUMN `closed_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `last_active_at` DATETIME(3) NULL,
    ADD COLUMN `last_login_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `stage_changes` (
    `id` CHAR(36) NOT NULL,
    `entity_type` ENUM('client_request', 'tender', 'project') NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `from_stage` VARCHAR(191) NULL,
    `to_stage` VARCHAR(191) NOT NULL,
    `changed_by` CHAR(36) NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stage_changes_entity_type_entity_id_changed_at_idx`(`entity_type`, `entity_id`, `changed_at`),
    INDEX `stage_changes_entity_type_to_stage_changed_at_idx`(`entity_type`, `to_stage`, `changed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_uptime_records` (
    `id` CHAR(36) NOT NULL,
    `system_id` CHAR(36) NOT NULL,
    `month` DATE NOT NULL,
    `uptime_percent` DECIMAL(5, 2) NOT NULL,
    `notes` TEXT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `system_uptime_records_system_id_month_key`(`system_id`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recruitment_placements` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `candidate_name` VARCHAR(191) NOT NULL,
    `position` VARCHAR(191) NULL,
    `placed_at` DATE NOT NULL,
    `notes` TEXT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recruitment_placements_project_id_placed_at_idx`(`project_id`, `placed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_assigned_user_id_fkey` FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `system_uptime_records` ADD CONSTRAINT `system_uptime_records_system_id_fkey` FOREIGN KEY (`system_id`) REFERENCES `it_systems`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recruitment_placements` ADD CONSTRAINT `recruitment_placements_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Best-known dates for existing records.
UPDATE `client_requests` SET `stage_changed_at` = `updated_at`;
UPDATE `tenders` SET `stage_changed_at` = COALESCE(
  CASE `stage`
    WHEN 'submitted' THEN `submitted_at`
    WHEN 'won' THEN `won_at`
    WHEN 'lost' THEN `lost_at`
    WHEN 'withdrawn' THEN `withdrawn_at`
    WHEN 'cancelled' THEN `cancelled_at`
  END, `updated_at`);
UPDATE `projects` SET `delivery_stage_changed_at` = `updated_at`;
UPDATE `projects` SET `completed_at` = `updated_at` WHERE `status` = 'completed';
UPDATE `tickets` SET `closed_at` = `updated_at` WHERE `status` = 'closed';

-- Start each record's stage history from its current stage.
INSERT INTO `stage_changes` (`id`, `entity_type`, `entity_id`, `from_stage`, `to_stage`, `changed_at`)
SELECT UUID(), 'client_request', `id`, NULL, `stage`, `stage_changed_at` FROM `client_requests`;
INSERT INTO `stage_changes` (`id`, `entity_type`, `entity_id`, `from_stage`, `to_stage`, `changed_at`)
SELECT UUID(), 'tender', `id`, NULL, `stage`, `stage_changed_at` FROM `tenders`;
INSERT INTO `stage_changes` (`id`, `entity_type`, `entity_id`, `from_stage`, `to_stage`, `changed_at`)
SELECT UUID(), 'project', `id`, NULL, `delivery_stage`, `delivery_stage_changed_at` FROM `projects`;
