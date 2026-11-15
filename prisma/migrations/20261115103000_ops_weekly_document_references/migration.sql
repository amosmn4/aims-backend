ALTER TABLE `ops_documents`
  ADD COLUMN `weekly_ref` VARCHAR(100) NULL,
  ADD INDEX `ops_documents_weekly_ref_idx` (`weekly_ref`);
