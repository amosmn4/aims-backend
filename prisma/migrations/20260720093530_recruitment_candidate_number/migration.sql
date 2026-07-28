-- AlterTable
ALTER TABLE `recruitment_candidates` ADD COLUMN `candidate_number` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `recruitment_candidates_candidate_number_key` ON `recruitment_candidates`(`candidate_number`);

