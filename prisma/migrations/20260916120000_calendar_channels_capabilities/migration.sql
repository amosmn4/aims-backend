-- CreateTable
CREATE TABLE `calendar_events` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `location` VARCHAR(191) NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NULL,
    `all_day` BOOLEAN NOT NULL DEFAULT true,
    `department_id` CHAR(36) NULL,
    `visibility` ENUM('everyone', 'department', 'private') NOT NULL DEFAULT 'everyone',
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `calendar_events_starts_at_idx`(`starts_at`),
    INDEX `calendar_events_department_id_idx`(`department_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_channel_preferences` (
    `user_id` CHAR(36) NOT NULL,
    `event_key` VARCHAR(40) NOT NULL,
    `email` BOOLEAN NOT NULL DEFAULT false,
    `sms` BOOLEAN NOT NULL DEFAULT false,
    `whatsapp` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`, `event_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_capabilities` (
    `role` ENUM('ceo', 'system_admin', 'finance', 'hr', 'it', 'marketing', 'tender', 'operations', 'water', 'department_head', 'account_manager', 'general_staff') NOT NULL,
    `capability` VARCHAR(60) NOT NULL,
    `allowed` BOOLEAN NOT NULL,
    `updated_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`role`, `capability`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `calendar_events` ADD CONSTRAINT `calendar_events_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_events` ADD CONSTRAINT `calendar_events_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_channel_preferences` ADD CONSTRAINT `notification_channel_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

