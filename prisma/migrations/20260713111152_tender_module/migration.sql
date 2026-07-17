-- AlterTable
ALTER TABLE `contracts` ADD COLUMN `tender_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `documents` MODIFY `resource_type` ENUM('project', 'task', 'finance_report', 'tender') NOT NULL;

-- CreateTable
CREATE TABLE `tenders` (
    `id` CHAR(36) NOT NULL,
    `reference_number` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `client_id` CHAR(36) NULL,
    `department_id` CHAR(36) NOT NULL,
    `service_line_id` CHAR(36) NULL,
    `account_manager_id` CHAR(36) NULL,
    `stage` ENUM('identified', 'in_progress', 'submitted', 'won', 'lost', 'withdrawn') NOT NULL DEFAULT 'identified',
    `estimated_value` DECIMAL(14, 2) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'KES',
    `submission_deadline` DATE NULL,
    `submitted_at` DATETIME(3) NULL,
    `won_at` DATETIME(3) NULL,
    `lost_at` DATETIME(3) NULL,
    `lost_reason` TEXT NULL,
    `notes` TEXT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenders_reference_number_key`(`reference_number`),
    INDEX `tenders_department_id_idx`(`department_id`),
    INDEX `tenders_stage_idx`(`stage`),
    INDEX `tenders_client_id_idx`(`client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tender_resources` (
    `id` CHAR(36) NOT NULL,
    `tender_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role_note` VARCHAR(191) NULL,
    `allocated_hours` DECIMAL(8, 2) NULL,
    `hourly_rate` DECIMAL(10, 2) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tender_resources_tender_id_user_id_key`(`tender_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tender_time_entries` (
    `id` CHAR(36) NOT NULL,
    `tender_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `entry_date` DATE NOT NULL,
    `hours` DECIMAL(5, 2) NOT NULL,
    `notes` TEXT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tender_time_entries_tender_id_idx`(`tender_id`),
    INDEX `tender_time_entries_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `contracts_tender_id_key` ON `contracts`(`tender_id`);

-- AddForeignKey
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_tender_id_fkey` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_service_line_id_fkey` FOREIGN KEY (`service_line_id`) REFERENCES `service_lines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_account_manager_id_fkey` FOREIGN KEY (`account_manager_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tender_resources` ADD CONSTRAINT `tender_resources_tender_id_fkey` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tender_resources` ADD CONSTRAINT `tender_resources_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tender_time_entries` ADD CONSTRAINT `tender_time_entries_tender_id_fkey` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tender_time_entries` ADD CONSTRAINT `tender_time_entries_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

