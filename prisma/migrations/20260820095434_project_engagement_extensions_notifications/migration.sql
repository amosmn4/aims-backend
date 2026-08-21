-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('task_due', 'project_alert', 'contract_expiry', 'invoice_overdue', 'tender_deadline', 'meeting', 'reminder', 'task_assigned', 'project_shared', 'document_shared', 'task_comment') NOT NULL;

-- AlterTable
ALTER TABLE `projects` ADD COLUMN `engagement_type` ENUM('one_off', 'ongoing') NOT NULL DEFAULT 'one_off';

-- CreateTable
CREATE TABLE `timeline_extensions` (
    `id` CHAR(36) NOT NULL,
    `entity_type` ENUM('project', 'task', 'milestone', 'contract') NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `previous_date` DATE NOT NULL,
    `new_date` DATE NOT NULL,
    `reason` TEXT NOT NULL,
    `attributed_to` ENUM('client', 'internal', 'third_party', 'other') NOT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `timeline_extensions_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `user_id` CHAR(36) NOT NULL,
    `task_updates` BOOLEAN NOT NULL DEFAULT true,
    `project_updates` BOOLEAN NOT NULL DEFAULT true,
    `finance_alerts` BOOLEAN NOT NULL DEFAULT true,
    `tender_alerts` BOOLEAN NOT NULL DEFAULT true,
    `reminders_meetings` BOOLEAN NOT NULL DEFAULT true,
    `email_digest` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `timeline_extensions` ADD CONSTRAINT `timeline_extensions_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
