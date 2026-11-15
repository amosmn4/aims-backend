ALTER TABLE `ops_business_finance`
ADD COLUMN `date` CHAR(10) NULL,
ADD COLUMN `description` TEXT NULL;

UPDATE `ops_business_finance`
SET
  `date` = CONCAT(`month`, '-01'),
  `description` = COALESCE(NULLIF(`note`, ''), 'Existing monthly finance record');

ALTER TABLE `ops_business_finance`
MODIFY `date` CHAR(10) NOT NULL,
MODIFY `description` TEXT NOT NULL,
DROP INDEX `ops_business_finance_business_month_key`,
ADD INDEX `ops_business_finance_business_month_idx` (`business`, `month`);
