-- AlterTable
ALTER TABLE `contracts` ADD COLUMN `client_request_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `documents` MODIFY `resource_type` ENUM('project', 'task', 'finance_report', 'tender', 'client_request') NOT NULL;

-- AlterTable
ALTER TABLE `projects` ADD COLUMN `client_request_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `client_requests` (
    `id` CHAR(36) NOT NULL,
    `reference_number` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `client_id` CHAR(36) NULL,
    `prospect_client_name` VARCHAR(191) NULL,
    `contact_name` VARCHAR(191) NULL,
    `contact_email` VARCHAR(191) NULL,
    `contact_phone` VARCHAR(191) NULL,
    `source` ENUM('operations', 'marketing', 'referral', 'website', 'other') NOT NULL DEFAULT 'other',
    `service_line_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `assigned_to_id` CHAR(36) NULL,
    `stage` ENUM('received', 'routed', 'engaged', 'converted', 'lost', 'withdrawn') NOT NULL DEFAULT 'received',
    `estimated_value` DECIMAL(14, 2) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'KES',
    `routed_at` DATETIME(3) NULL,
    `engaged_at` DATETIME(3) NULL,
    `converted_at` DATETIME(3) NULL,
    `conversion_type` ENUM('project', 'recurring_contract') NULL,
    `lost_at` DATETIME(3) NULL,
    `lost_from_stage` ENUM('received', 'routed', 'engaged', 'converted', 'lost', 'withdrawn') NULL,
    `lost_reason` TEXT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `client_requests_reference_number_key`(`reference_number`),
    INDEX `client_requests_department_id_idx`(`department_id`),
    INDEX `client_requests_stage_idx`(`stage`),
    INDEX `client_requests_client_id_idx`(`client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_request_activities` (
    `id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `type` ENUM('note', 'call', 'email', 'meeting') NOT NULL DEFAULT 'note',
    `summary` TEXT NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `client_request_activities_request_id_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `contracts_client_request_id_key` ON `contracts`(`client_request_id`);

-- CreateIndex
CREATE UNIQUE INDEX `projects_client_request_id_key` ON `projects`(`client_request_id`);

-- AddForeignKey
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_client_request_id_fkey` FOREIGN KEY (`client_request_id`) REFERENCES `client_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_client_request_id_fkey` FOREIGN KEY (`client_request_id`) REFERENCES `client_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_requests` ADD CONSTRAINT `client_requests_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_requests` ADD CONSTRAINT `client_requests_service_line_id_fkey` FOREIGN KEY (`service_line_id`) REFERENCES `service_lines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_requests` ADD CONSTRAINT `client_requests_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_requests` ADD CONSTRAINT `client_requests_assigned_to_id_fkey` FOREIGN KEY (`assigned_to_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_requests` ADD CONSTRAINT `client_requests_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_request_activities` ADD CONSTRAINT `client_request_activities_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `client_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_request_activities` ADD CONSTRAINT `client_request_activities_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

