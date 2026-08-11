-- AlterTable
ALTER TABLE `tenders` ADD COLUMN `lost_from_stage` ENUM('identified', 'applying', 'submitted', 'evaluation', 'won', 'lost', 'withdrawn') NULL;
