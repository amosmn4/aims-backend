-- CreateTable
CREATE TABLE `water_zones` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `water_zones_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `water_subzones` (
    `id` CHAR(36) NOT NULL,
    `zone_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `water_subzones_zone_id_name_key`(`zone_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `water_customers` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `plot_no` VARCHAR(191) NULL,
    `zone_id` CHAR(36) NULL,
    `subzone_id` CHAR(36) NULL,
    `phone` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `water_customers_zone_id_idx`(`zone_id`),
    INDEX `water_customers_subzone_id_idx`(`subzone_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `water_meters` (
    `id` CHAR(36) NOT NULL,
    `meter_number` VARCHAR(191) NOT NULL,
    `meter_type` ENUM('main', 'bulk', 'household') NOT NULL DEFAULT 'household',
    `customer_id` CHAR(36) NULL,
    `zone_id` CHAR(36) NULL,
    `subzone_id` CHAR(36) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `water_meters_meter_number_key`(`meter_number`),
    INDEX `water_meters_customer_id_idx`(`customer_id`),
    INDEX `water_meters_zone_id_idx`(`zone_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `water_usage_uploads` (
    `id` CHAR(36) NOT NULL,
    `file_name` VARCHAR(191) NOT NULL,
    `record_count` INTEGER NOT NULL DEFAULT 0,
    `uploaded_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `water_usage_records` (
    `id` CHAR(36) NOT NULL,
    `meter_id` CHAR(36) NOT NULL,
    `customer_id` CHAR(36) NULL,
    `customer_name` VARCHAR(191) NOT NULL,
    `units_sold` DECIMAL(12, 2) NOT NULL,
    `amount_paid` DECIMAL(14, 2) NOT NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    `source` ENUM('seed', 'upload', 'manual') NOT NULL DEFAULT 'manual',
    `upload_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `water_usage_records_meter_id_recorded_at_idx`(`meter_id`, `recorded_at`),
    INDEX `water_usage_records_recorded_at_idx`(`recorded_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `water_meter_readings` (
    `id` CHAR(36) NOT NULL,
    `meter_id` CHAR(36) NOT NULL,
    `reading_date` DATETIME(3) NOT NULL,
    `value` DECIMAL(14, 2) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `water_meter_readings_meter_id_reading_date_idx`(`meter_id`, `reading_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `water_subzones` ADD CONSTRAINT `water_subzones_zone_id_fkey` FOREIGN KEY (`zone_id`) REFERENCES `water_zones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `water_customers` ADD CONSTRAINT `water_customers_zone_id_fkey` FOREIGN KEY (`zone_id`) REFERENCES `water_zones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `water_customers` ADD CONSTRAINT `water_customers_subzone_id_fkey` FOREIGN KEY (`subzone_id`) REFERENCES `water_subzones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `water_meters` ADD CONSTRAINT `water_meters_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `water_customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `water_meters` ADD CONSTRAINT `water_meters_zone_id_fkey` FOREIGN KEY (`zone_id`) REFERENCES `water_zones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `water_meters` ADD CONSTRAINT `water_meters_subzone_id_fkey` FOREIGN KEY (`subzone_id`) REFERENCES `water_subzones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `water_usage_uploads` ADD CONSTRAINT `water_usage_uploads_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `water_usage_records` ADD CONSTRAINT `water_usage_records_meter_id_fkey` FOREIGN KEY (`meter_id`) REFERENCES `water_meters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `water_usage_records` ADD CONSTRAINT `water_usage_records_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `water_customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `water_usage_records` ADD CONSTRAINT `water_usage_records_upload_id_fkey` FOREIGN KEY (`upload_id`) REFERENCES `water_usage_uploads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `water_meter_readings` ADD CONSTRAINT `water_meter_readings_meter_id_fkey` FOREIGN KEY (`meter_id`) REFERENCES `water_meters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `water_meter_readings` ADD CONSTRAINT `water_meter_readings_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
