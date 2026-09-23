-- AlterTable
ALTER TABLE `company_settings` ADD COLUMN `report_reminders_enabled` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `documents` MODIFY `resource_type` ENUM('project', 'task', 'finance_report', 'department_report', 'tender', 'client_request', 'tender_document_library', 'department', 'it_system') NOT NULL;

-- AlterTable
ALTER TABLE `it_systems` ADD COLUMN `current_stage` ENUM('requirements', 'design', 'development', 'testing', 'deployment', 'maintenance') NULL,
    ADD COLUMN `docs_url` VARCHAR(191) NULL,
    ADD COLUMN `live_url` VARCHAR(191) NULL,
    ADD COLUMN `progress_percent` INTEGER NULL,
    ADD COLUMN `purpose` TEXT NULL,
    ADD COLUMN `repo_url` VARCHAR(191) NULL,
    ADD COLUMN `tech_stack` JSON NULL,
    ADD COLUMN `tools` JSON NULL;

-- AlterTable
ALTER TABLE `notification_channel_preferences` ADD COLUMN `in_app` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `muted_until` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `it_system_stages` (
    `id` CHAR(36) NOT NULL,
    `system_id` CHAR(36) NOT NULL,
    `stage` ENUM('requirements', 'design', 'development', 'testing', 'deployment', 'maintenance') NOT NULL,
    `status` ENUM('not_started', 'in_progress', 'done') NOT NULL DEFAULT 'not_started',
    `notes` TEXT NULL,
    `started_at` DATE NULL,
    `done_at` DATE NULL,
    `updated_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `it_system_stages_system_id_stage_key`(`system_id`, `stage`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `it_system_features` (
    `id` CHAR(36) NOT NULL,
    `system_id` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('planned', 'building', 'live', 'dropped') NOT NULL DEFAULT 'planned',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `it_system_features_system_id_idx`(`system_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `it_system_stages` ADD CONSTRAINT `it_system_stages_system_id_fkey` FOREIGN KEY (`system_id`) REFERENCES `it_systems`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `it_system_features` ADD CONSTRAINT `it_system_features_system_id_fkey` FOREIGN KEY (`system_id`) REFERENCES `it_systems`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

