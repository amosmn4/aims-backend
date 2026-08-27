-- DropForeignKey
ALTER TABLE `recruitment_candidates` DROP FOREIGN KEY `recruitment_candidates_project_id_fkey`;

-- DropTable
DROP TABLE `recruitment_candidates`;

-- CreateTable
CREATE TABLE `recruitment_funnels` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `applications_received` INTEGER NOT NULL DEFAULT 0,
    `screened` INTEGER NOT NULL DEFAULT 0,
    `interviewed` INTEGER NOT NULL DEFAULT 0,
    `offered` INTEGER NOT NULL DEFAULT 0,
    `placed` INTEGER NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `updated_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `recruitment_funnels_project_id_key`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `recruitment_funnels` ADD CONSTRAINT `recruitment_funnels_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

