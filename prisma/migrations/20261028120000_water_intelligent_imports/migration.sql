ALTER TABLE `water_meter_readings`
  MODIFY COLUMN `value` DECIMAL(14, 2) NULL,
  ADD COLUMN `review` JSON NULL;

CREATE TABLE `water_meter_usage_intervals` (
  `id` CHAR(36) NOT NULL,
  `meter_id` CHAR(36) NOT NULL,
  `period_start` DATETIME(3) NOT NULL,
  `period_end` DATETIME(3) NOT NULL,
  `units` DECIMAL(14, 2) NOT NULL,
  `notes` TEXT NULL,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `water_meter_usage_intervals_meter_id_period_start_period_end_idx` (`meter_id`, `period_start`, `period_end`),
  CONSTRAINT `water_meter_usage_intervals_meter_id_fkey` FOREIGN KEY (`meter_id`) REFERENCES `water_meters` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `water_import_batches` (
  `id` CHAR(36) NOT NULL,
  `file_name` VARCHAR(191) NOT NULL,
  `mime_type` VARCHAR(191) NOT NULL,
  `storage_key` VARCHAR(191) NOT NULL,
  `file_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'queued',
  `uploaded_by` CHAR(36) NOT NULL,
  `total_rows` INTEGER NOT NULL DEFAULT 0,
  `processed_parts` INTEGER NOT NULL DEFAULT 0,
  `total_parts` INTEGER NOT NULL DEFAULT 0,
  `summary` JSON NULL,
  `error` TEXT NULL,
  `lease_until` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `water_import_batches_status_lease_until_idx` (`status`, `lease_until`),
  INDEX `water_import_batches_file_hash_idx` (`file_hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `water_import_rows` (
  `id` CHAR(36) NOT NULL,
  `batch_id` CHAR(36) NOT NULL,
  `position` INTEGER NOT NULL,
  `source` VARCHAR(191) NOT NULL,
  `raw` JSON NOT NULL,
  `data` JSON NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `issues` JSON NULL,
  `warnings` JSON NULL,
  `target_type` VARCHAR(191) NULL,
  `target_id` CHAR(36) NULL,
  `confirmed_by` CHAR(36) NULL,
  `confirmed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `water_import_rows_batch_id_position_key` (`batch_id`, `position`),
  INDEX `water_import_rows_batch_id_status_idx` (`batch_id`, `status`),
  CONSTRAINT `water_import_rows_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `water_import_batches` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
