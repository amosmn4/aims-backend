-- CreateTable
CREATE TABLE `inventory_items` (
    `id` CHAR(36) NOT NULL,
    `asset_tag` VARCHAR(191) NOT NULL,
    `device_name` VARCHAR(191) NOT NULL,
    `category` ENUM('laptop', 'desktop', 'monitor', 'printer', 'peripheral', 'other') NOT NULL,
    `status` ENUM('in_use', 'in_storage', 'under_repair', 'retired') NOT NULL DEFAULT 'in_use',
    `brand` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `serial_number` VARCHAR(191) NULL,
    `assigned_to` VARCHAR(191) NULL,
    `office_id` CHAR(36) NULL,
    `purchase_date` DATETIME(3) NULL,
    `warranty_expiry` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inventory_items_asset_tag_key`(`asset_tag`),
    INDEX `inventory_items_office_id_idx`(`office_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_office_id_fkey` FOREIGN KEY (`office_id`) REFERENCES `offices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
