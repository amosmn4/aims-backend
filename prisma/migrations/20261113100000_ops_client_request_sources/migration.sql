ALTER TABLE `ops_client_requests`
  MODIFY `client` CHAR(36) NULL,
  ADD COLUMN `prospect_client_name` VARCHAR(200) NULL,
  ADD COLUMN `source` VARCHAR(20) NOT NULL DEFAULT 'operations';
