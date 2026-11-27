ALTER TABLE `ops_staff`
  ADD COLUMN `submission_reminder_minutes` INTEGER NOT NULL DEFAULT 60;

ALTER TABLE `ops_weekly_reports`
  ADD COLUMN `late_reason` TEXT NULL;

CREATE TABLE `ops_project_notes` (
  `id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `staff_id` CHAR(36) NOT NULL,
  `note` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ops_project_notes_project_id_created_at_idx` (`project_id`, `created_at`),
  CONSTRAINT `ops_project_notes_project_id_fkey`
    FOREIGN KEY (`project_id`) REFERENCES `ops_projects` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ops_project_notes_staff_id_fkey`
    FOREIGN KEY (`staff_id`) REFERENCES `ops_staff` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
