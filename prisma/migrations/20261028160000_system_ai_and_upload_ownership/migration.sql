ALTER TABLE `water_import_batches` ADD COLUMN `preview_version` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `water_ai_chat_messages` ADD COLUMN `evidence` JSON NULL;

CREATE TABLE `ai_chat_messages` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `context_key` VARCHAR(191) NOT NULL DEFAULT 'system',
  `role` ENUM('user', 'assistant') NOT NULL,
  `content` TEXT NOT NULL,
  `evidence` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ai_chat_messages_user_id_context_key_created_at_idx` (`user_id`, `context_key`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ai_chat_messages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `water_upload_entities` (
  `id` CHAR(36) NOT NULL,
  `upload_kind` VARCHAR(16) NOT NULL,
  `upload_id` CHAR(36) NOT NULL,
  `entity_type` VARCHAR(16) NOT NULL,
  `entity_id` CHAR(36) NOT NULL,
  `snapshot` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `water_upload_entities_entity_type_entity_id_key` (`entity_type`, `entity_id`),
  INDEX `water_upload_entities_upload_kind_upload_id_idx` (`upload_kind`, `upload_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `water_upload_removal_jobs` (
  `id` CHAR(36) NOT NULL,
  `storage_key` VARCHAR(191) NOT NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `error` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
