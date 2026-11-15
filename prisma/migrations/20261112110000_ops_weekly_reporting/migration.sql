ALTER TABLE `ops_staff` ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE TABLE `ops_weekly_settings` (
  `id` VARCHAR(20) NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `settings` JSON NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ops_weekly_reports` (
  `id` CHAR(36) NOT NULL,
  `staff_id` CHAR(36) NOT NULL,
  `week_start` CHAR(10) NOT NULL,
  `phase` ENUM('plan', 'report') NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `submission` JSON NOT NULL,
  `submitted_at` DATETIME(3) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `reviewer_id` CHAR(36) NULL,
  `review_comment` TEXT NULL,
  `returned_at` DATETIME(3) NULL,
  `return_comment` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ops_weekly_reports_staff_id_week_start_phase_key` (`staff_id`, `week_start`, `phase`),
  INDEX `ops_weekly_reports_week_start_phase_submitted_at_idx` (`week_start`, `phase`, `submitted_at`),
  CONSTRAINT `ops_weekly_reports_staff_id_fkey` FOREIGN KEY (`staff_id`) REFERENCES `ops_staff` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ops_weekly_reports_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `ops_staff` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ops_weekly_deliveries` (
  `id` CHAR(36) NOT NULL,
  `recipient_id` CHAR(36) NOT NULL,
  `week_start` CHAR(10) NOT NULL,
  `phase` ENUM('plan', 'report') NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `lease_token` CHAR(36) NULL,
  `lease_until` DATETIME(3) NULL,
  `subject` VARCHAR(255) NOT NULL,
  `html` LONGTEXT NOT NULL,
  `plain_text` LONGTEXT NOT NULL,
  `message_id` VARCHAR(255) NOT NULL,
  `sent_at` DATETIME(3) NULL,
  `last_error` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ops_weekly_deliveries_recipient_id_week_start_phase_key` (`recipient_id`, `week_start`, `phase`),
  UNIQUE INDEX `ops_weekly_deliveries_message_id_key` (`message_id`),
  INDEX `ops_weekly_deliveries_status_lease_until_idx` (`status`, `lease_until`),
  CONSTRAINT `ops_weekly_deliveries_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `ops_staff` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
