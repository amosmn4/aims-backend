ALTER TABLE `ops_sessions`
    ADD COLUMN `impersonated_staff_id` CHAR(36) NULL,
    ADD COLUMN `impersonation_version` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `ops_sessions_impersonated_staff_id_idx` ON `ops_sessions`(`impersonated_staff_id`);

ALTER TABLE `ops_sessions` ADD CONSTRAINT `ops_sessions_impersonated_staff_id_fkey`
    FOREIGN KEY (`impersonated_staff_id`) REFERENCES `ops_staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
