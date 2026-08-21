-- AlterTable
ALTER TABLE `tenders` ADD COLUMN `cancelled_at` DATETIME(3) NULL,
    MODIFY `stage` ENUM('identified', 'applying', 'submitted', 'won', 'lost', 'withdrawn', 'cancelled') NOT NULL DEFAULT 'identified',
    MODIFY `lost_from_stage` ENUM('identified', 'applying', 'submitted', 'won', 'lost', 'withdrawn', 'cancelled') NULL;
