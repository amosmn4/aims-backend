-- AlterTable
ALTER TABLE `projects` ADD COLUMN `service_line_id` CHAR(36) NULL;

-- CreateIndex
CREATE INDEX `projects_service_line_id_idx` ON `projects`(`service_line_id`);

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_service_line_id_fkey` FOREIGN KEY (`service_line_id`) REFERENCES `service_lines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from the project's contract, then originating tender, then client request.
UPDATE `projects` p JOIN `contracts` c ON c.`id` = p.`contract_id`
SET p.`service_line_id` = c.`service_line_id`
WHERE p.`service_line_id` IS NULL AND c.`service_line_id` IS NOT NULL;

UPDATE `projects` p JOIN `tenders` t ON t.`id` = p.`tender_id`
SET p.`service_line_id` = t.`service_line_id`
WHERE p.`service_line_id` IS NULL AND t.`service_line_id` IS NOT NULL;

UPDATE `projects` p JOIN `client_requests` r ON r.`id` = p.`client_request_id`
SET p.`service_line_id` = r.`service_line_id`
WHERE p.`service_line_id` IS NULL AND r.`service_line_id` IS NOT NULL;
