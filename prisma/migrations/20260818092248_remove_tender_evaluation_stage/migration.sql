-- "Under Evaluation" was functionally the same step as "Submitted" and is being removed as a
-- distinct stage. Remap any existing rows before narrowing the enum, so this is safe to run
-- against a database with real data in that stage, not just a database confirmed empty of it in
-- one environment.
UPDATE `tenders` SET `stage` = 'submitted' WHERE `stage` = 'evaluation';
UPDATE `tenders` SET `lost_from_stage` = 'submitted' WHERE `lost_from_stage` = 'evaluation';

-- AlterTable
ALTER TABLE `tenders` MODIFY `stage` ENUM('identified', 'applying', 'submitted', 'won', 'lost', 'withdrawn') NOT NULL DEFAULT 'identified',
    MODIFY `lost_from_stage` ENUM('identified', 'applying', 'submitted', 'won', 'lost', 'withdrawn') NULL;
