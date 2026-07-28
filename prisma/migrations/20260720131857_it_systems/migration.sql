-- CreateTable
CREATE TABLE `it_systems` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('website', 'internal_system', 'integration') NOT NULL,
    `status` ENUM('active', 'inactive', 'deprecated') NOT NULL DEFAULT 'active',
    `owner` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

