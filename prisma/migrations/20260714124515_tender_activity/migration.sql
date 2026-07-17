-- CreateTable
CREATE TABLE `tender_activities` (
    `id` CHAR(36) NOT NULL,
    `tender_id` CHAR(36) NOT NULL,
    `type` ENUM('note', 'call', 'email', 'meeting') NOT NULL DEFAULT 'note',
    `summary` TEXT NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tender_activities_tender_id_idx`(`tender_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tender_activities` ADD CONSTRAINT `tender_activities_tender_id_fkey` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tender_activities` ADD CONSTRAINT `tender_activities_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

