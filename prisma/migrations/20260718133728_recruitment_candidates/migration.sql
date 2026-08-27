-- CreateTable
CREATE TABLE `recruitment_candidates` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `candidate_name` VARCHAR(191) NOT NULL,
    `contact_email` VARCHAR(191) NULL,
    `contact_phone` VARCHAR(191) NULL,
    `role_title` VARCHAR(191) NOT NULL,
    `source` ENUM('referral', 'job_board', 'linkedin', 'database', 'other') NOT NULL DEFAULT 'other',
    `stage` ENUM('sourced', 'screening', 'client_review', 'interview', 'offer', 'placed', 'rejected', 'withdrawn') NOT NULL DEFAULT 'sourced',
    `notes` TEXT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `recruitment_candidates_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `recruitment_candidates` ADD CONSTRAINT `recruitment_candidates_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

