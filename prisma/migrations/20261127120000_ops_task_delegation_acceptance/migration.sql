CREATE TABLE `ops_task_delegations` (
  `id` CHAR(36) NOT NULL,
  `task_id` CHAR(36) NOT NULL,
  `pending_task_id` CHAR(36) NULL,
  `task_title` VARCHAR(200) NOT NULL,
  `sender_id` CHAR(36) NOT NULL,
  `recipient_id` CHAR(36) NOT NULL,
  `week_start` CHAR(10) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `responded_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ops_task_delegations_pending_task_id_key` (`pending_task_id`),
  INDEX `ops_task_delegations_sender_id_status_idx` (`sender_id`, `status`),
  INDEX `ops_task_delegations_recipient_id_status_idx` (`recipient_id`, `status`),
  CONSTRAINT `ops_task_delegations_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `ops_tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ops_task_delegations_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `ops_staff` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ops_task_delegations_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `ops_staff` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
