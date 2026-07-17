-- AlterTable
ALTER TABLE `tenders` ADD COLUMN `prospect_client_name` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `tender_cost_items` (
    `id` CHAR(36) NOT NULL,
    `tender_id` CHAR(36) NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'other',
    `description` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tender_cost_items_tender_id_idx`(`tender_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tender_bonds` (
    `id` CHAR(36) NOT NULL,
    `tender_id` CHAR(36) NOT NULL,
    `bond_type` ENUM('bid_bond', 'performance_bond', 'other') NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `provider` VARCHAR(191) NULL,
    `status` ENUM('pending', 'lodged', 'released', 'forfeited') NOT NULL DEFAULT 'pending',
    `issued_date` DATE NULL,
    `expiry_date` DATE NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tender_bonds_tender_id_idx`(`tender_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tender_pricing_items` (
    `id` CHAR(36) NOT NULL,
    `tender_id` CHAR(36) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `description` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL DEFAULT 1,
    `unit_price` DECIMAL(14, 2) NOT NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tender_pricing_items_tender_id_idx`(`tender_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tender_requirement_templates` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tender_requirement_template_items` (
    `id` CHAR(36) NOT NULL,
    `template_id` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'general',
    `sort_order` INTEGER NOT NULL DEFAULT 0,

    INDEX `tender_requirement_template_items_template_id_idx`(`template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tender_requirements` (
    `id` CHAR(36) NOT NULL,
    `tender_id` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'general',
    `status` ENUM('pending', 'in_progress', 'obtained', 'not_applicable') NOT NULL DEFAULT 'pending',
    `notes` TEXT NULL,
    `document_id` CHAR(36) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tender_requirements_tender_id_idx`(`tender_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tender_cost_items` ADD CONSTRAINT `tender_cost_items_tender_id_fkey` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tender_bonds` ADD CONSTRAINT `tender_bonds_tender_id_fkey` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tender_pricing_items` ADD CONSTRAINT `tender_pricing_items_tender_id_fkey` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tender_requirement_template_items` ADD CONSTRAINT `tender_requirement_template_items_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `tender_requirement_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tender_requirements` ADD CONSTRAINT `tender_requirements_tender_id_fkey` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tender_requirements` ADD CONSTRAINT `tender_requirements_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

