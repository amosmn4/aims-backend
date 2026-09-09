-- CreateTable
CREATE TABLE `water_ai_insights` (
    `id` CHAR(36) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `summary` TEXT NOT NULL,
    `anomalies` JSON NOT NULL,
    `reasons` JSON NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `generated_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `water_ai_insights_month_created_at_idx`(`month`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `water_ai_chat_messages` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role` ENUM('user', 'assistant') NOT NULL,
    `content` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `water_ai_chat_messages_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `water_ai_insights` ADD CONSTRAINT `water_ai_insights_generated_by_fkey` FOREIGN KEY (`generated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `water_ai_chat_messages` ADD CONSTRAINT `water_ai_chat_messages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
