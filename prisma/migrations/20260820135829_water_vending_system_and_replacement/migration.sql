-- AlterTable
ALTER TABLE `water_meters` ADD COLUMN `replaces_meter_id` CHAR(36) NULL,
    ADD COLUMN `vending_system` ENUM('amsol', 'mpaya') NOT NULL DEFAULT 'amsol';

-- CreateIndex
CREATE UNIQUE INDEX `water_meters_replaces_meter_id_key` ON `water_meters`(`replaces_meter_id`);

-- CreateIndex
CREATE INDEX `water_meters_replaces_meter_id_idx` ON `water_meters`(`replaces_meter_id`);

-- AddForeignKey
ALTER TABLE `water_meters` ADD CONSTRAINT `water_meters_replaces_meter_id_fkey` FOREIGN KEY (`replaces_meter_id`) REFERENCES `water_meters`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
