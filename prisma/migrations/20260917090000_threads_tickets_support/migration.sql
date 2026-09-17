-- AlterTable
ALTER TABLE `client_request_activities` ADD COLUMN `parent_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `company_settings` ADD COLUMN `support_contact_email` VARCHAR(191) NULL,
    ADD COLUMN `support_contact_name` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `debtor_follow_ups` ADD COLUMN `parent_id` CHAR(36) NULL,
    MODIFY `type` ENUM('reminder_sent', 'promise_to_pay', 'escalated', 'note') NOT NULL;

-- AlterTable
ALTER TABLE `documents` MODIFY `resource_type` ENUM('project', 'task', 'finance_report', 'department_report', 'tender', 'client_request', 'tender_document_library', 'department') NOT NULL;

-- AlterTable
ALTER TABLE `lead_activities` ADD COLUMN `parent_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('task_due', 'project_alert', 'contract_expiry', 'invoice_overdue', 'tender_deadline', 'meeting', 'reminder', 'task_assigned', 'project_shared', 'document_shared', 'task_comment', 'client_request_assigned', 'report_submitted', 'report_reviewed', 'report_comment', 'report_due', 'comment_reply', 'ticket_update') NOT NULL;

-- AlterTable
ALTER TABLE `project_activities` ADD COLUMN `parent_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `task_comments` ADD COLUMN `parent_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `tender_activities` ADD COLUMN `parent_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `ticket_comments` (
    `id` CHAR(36) NOT NULL,
    `ticket_id` CHAR(36) NOT NULL,
    `author_id` CHAR(36) NOT NULL,
    `body` TEXT NOT NULL,
    `parent_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ticket_comments_ticket_id_idx`(`ticket_id`),
    INDEX `ticket_comments_parent_id_idx`(`parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `client_request_activities_parent_id_idx` ON `client_request_activities`(`parent_id`);

-- CreateIndex
CREATE INDEX `debtor_follow_ups_parent_id_idx` ON `debtor_follow_ups`(`parent_id`);

-- CreateIndex
CREATE INDEX `lead_activities_parent_id_idx` ON `lead_activities`(`parent_id`);

-- CreateIndex
CREATE INDEX `project_activities_parent_id_idx` ON `project_activities`(`parent_id`);

-- CreateIndex
CREATE INDEX `task_comments_parent_id_idx` ON `task_comments`(`parent_id`);

-- CreateIndex
CREATE INDEX `tender_activities_parent_id_idx` ON `tender_activities`(`parent_id`);

-- AddForeignKey
ALTER TABLE `debtor_follow_ups` ADD CONSTRAINT `debtor_follow_ups_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `debtor_follow_ups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_activities` ADD CONSTRAINT `project_activities_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `project_activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_comments` ADD CONSTRAINT `task_comments_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `task_comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tender_activities` ADD CONSTRAINT `tender_activities_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `tender_activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_request_activities` ADD CONSTRAINT `client_request_activities_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `client_request_activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `lead_activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_comments` ADD CONSTRAINT `ticket_comments_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_comments` ADD CONSTRAINT `ticket_comments_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_comments` ADD CONSTRAINT `ticket_comments_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `ticket_comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

