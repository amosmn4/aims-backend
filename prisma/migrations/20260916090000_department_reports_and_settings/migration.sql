-- AlterTable
ALTER TABLE `documents` MODIFY `resource_type` ENUM('project', 'task', 'finance_report', 'department_report', 'tender', 'client_request', 'tender_document_library') NOT NULL;

-- AlterTable
ALTER TABLE `finance_report_comments` ADD COLUMN `kind` ENUM('comment', 'submitted', 'resubmitted', 'changes_requested', 'approved') NOT NULL DEFAULT 'comment',
    ADD COLUMN `parent_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('task_due', 'project_alert', 'contract_expiry', 'invoice_overdue', 'tender_deadline', 'meeting', 'reminder', 'task_assigned', 'project_shared', 'document_shared', 'task_comment', 'client_request_assigned', 'report_submitted', 'report_reviewed', 'report_comment', 'report_due') NOT NULL;

-- CreateTable
CREATE TABLE `department_reports` (
    `id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `period_type` ENUM('monthly', 'quarterly', 'annual', 'other') NOT NULL DEFAULT 'monthly',
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `summary` TEXT NULL,
    `figures` JSON NOT NULL,
    `status` ENUM('draft', 'submitted', 'changes_requested', 'approved') NOT NULL DEFAULT 'draft',
    `submitted_by` CHAR(36) NULL,
    `submitted_at` DATETIME(3) NULL,
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `department_reports_department_id_status_idx`(`department_id`, `status`),
    INDEX `department_reports_period_end_idx`(`period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department_report_messages` (
    `id` CHAR(36) NOT NULL,
    `report_id` CHAR(36) NOT NULL,
    `author_id` CHAR(36) NOT NULL,
    `kind` ENUM('comment', 'submitted', 'resubmitted', 'changes_requested', 'approved') NOT NULL DEFAULT 'comment',
    `parent_id` CHAR(36) NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `department_report_messages_report_id_created_at_idx`(`report_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_email_subscriptions` (
    `user_id` CHAR(36) NOT NULL,
    `report_key` VARCHAR(40) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`, `report_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_settings` (
    `id` VARCHAR(20) NOT NULL DEFAULT 'company',
    `company_name` VARCHAR(191) NOT NULL DEFAULT 'Africa Management Solutions Ltd',
    `logo_data_url` MEDIUMTEXT NULL,
    `currency_code` VARCHAR(3) NOT NULL DEFAULT 'KES',
    `financial_year_start_month` INTEGER NOT NULL DEFAULT 1,
    `time_zone` VARCHAR(191) NOT NULL DEFAULT 'Africa/Nairobi',
    `report_due_day` INTEGER NOT NULL DEFAULT 5,
    `updated_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `finance_report_comments_parent_id_idx` ON `finance_report_comments`(`parent_id`);

-- AddForeignKey
ALTER TABLE `finance_report_comments` ADD CONSTRAINT `finance_report_comments_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `finance_report_comments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_reports` ADD CONSTRAINT `department_reports_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_reports` ADD CONSTRAINT `department_reports_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_reports` ADD CONSTRAINT `department_reports_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_report_messages` ADD CONSTRAINT `department_report_messages_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `department_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_report_messages` ADD CONSTRAINT `department_report_messages_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_report_messages` ADD CONSTRAINT `department_report_messages_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `department_report_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_email_subscriptions` ADD CONSTRAINT `report_email_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Keep past CEO review notes as messages in the report conversation.
INSERT INTO `finance_report_comments` (`id`, `report_id`, `author_id`, `kind`, `body`, `created_at`, `updated_at`)
SELECT UUID(), `id`, `reviewed_by`, IF(`status` = 'approved', 'approved', 'changes_requested'), `review_note`,
       COALESCE(`reviewed_at`, `updated_at`), COALESCE(`reviewed_at`, `updated_at`)
FROM `finance_reports`
WHERE `review_note` IS NOT NULL AND `review_note` <> '' AND `reviewed_by` IS NOT NULL
  AND `status` IN ('approved', 'changes_requested');

INSERT IGNORE INTO `company_settings` (`id`, `updated_at`) VALUES ('company', CURRENT_TIMESTAMP(3));
