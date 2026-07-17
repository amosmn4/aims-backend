-- Pipeline rework: rename tender/client-request stage vocabulary to match the AMSOL Pipeline
-- prototype, add the new "evaluation" and "proposal" stages, and add Project.deliveryStage +
-- Project.tenderId. Existing rows use the OLD enum values, so each stage column is widened to
-- accept both old and new values, backfilled, then narrowed to the final set — a direct
-- MODIFY straight to the new enum would silently corrupt (or reject, in strict mode) any row
-- still holding an old value.

-- ===== tenders.stage: in_progress -> applying =====
ALTER TABLE `tenders`
  MODIFY `stage` ENUM('identified','in_progress','applying','submitted','evaluation','won','lost','withdrawn') NOT NULL DEFAULT 'identified';

UPDATE `tenders` SET `stage` = 'applying' WHERE `stage` = 'in_progress';

ALTER TABLE `tenders`
  MODIFY `stage` ENUM('identified','applying','submitted','evaluation','won','lost','withdrawn') NOT NULL DEFAULT 'identified',
  ADD COLUMN `withdrawn_at` DATETIME(3) NULL;

-- ===== client_requests.stage / lost_from_stage: received->new, routed->assigned, engaged->engaging, converted->won =====
ALTER TABLE `client_requests`
  MODIFY `stage` ENUM('received','routed','engaged','converted','lost','withdrawn','new','assigned','engaging','proposal','won') NOT NULL DEFAULT 'received',
  MODIFY `lost_from_stage` ENUM('received','routed','engaged','converted','lost','withdrawn','new','assigned','engaging','proposal','won') NULL;

UPDATE `client_requests` SET `stage` = 'new' WHERE `stage` = 'received';
UPDATE `client_requests` SET `stage` = 'assigned' WHERE `stage` = 'routed';
UPDATE `client_requests` SET `stage` = 'engaging' WHERE `stage` = 'engaged';
UPDATE `client_requests` SET `stage` = 'won' WHERE `stage` = 'converted';
UPDATE `client_requests` SET `lost_from_stage` = 'new' WHERE `lost_from_stage` = 'received';
UPDATE `client_requests` SET `lost_from_stage` = 'assigned' WHERE `lost_from_stage` = 'routed';
UPDATE `client_requests` SET `lost_from_stage` = 'engaging' WHERE `lost_from_stage` = 'engaged';
UPDATE `client_requests` SET `lost_from_stage` = 'won' WHERE `lost_from_stage` = 'converted';

ALTER TABLE `client_requests`
  MODIFY `stage` ENUM('new','assigned','engaging','proposal','won','lost','withdrawn') NOT NULL DEFAULT 'new',
  MODIFY `lost_from_stage` ENUM('new','assigned','engaging','proposal','won','lost','withdrawn') NULL,
  ADD COLUMN `proposal_sent_at` DATETIME(3) NULL;

-- ===== projects: delivery pipeline position + optional tender source =====
ALTER TABLE `projects`
  ADD COLUMN `delivery_stage` ENUM('onboarding', 'in_progress', 'delivery', 'invoicing', 'payment', 'closed') NOT NULL DEFAULT 'onboarding',
  ADD COLUMN `tender_id` CHAR(36) NULL;

CREATE UNIQUE INDEX `projects_tender_id_key` ON `projects`(`tender_id`);
CREATE INDEX `projects_delivery_stage_idx` ON `projects`(`delivery_stage`);

ALTER TABLE `projects` ADD CONSTRAINT `projects_tender_id_fkey` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
