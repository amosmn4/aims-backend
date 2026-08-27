-- DropForeignKey
ALTER TABLE `water_customers` DROP FOREIGN KEY `water_customers_subzone_id_fkey`;

-- DropForeignKey
ALTER TABLE `water_meters` DROP FOREIGN KEY `water_meters_subzone_id_fkey`;

-- DropForeignKey
ALTER TABLE `water_subzones` DROP FOREIGN KEY `water_subzones_zone_id_fkey`;

-- DropIndex
DROP INDEX `water_customers_subzone_id_idx` ON `water_customers`;

-- DropIndex
DROP INDEX `water_meters_subzone_id_fkey` ON `water_meters`;

-- DropIndex
DROP INDEX `water_zones_name_key` ON `water_zones`;

-- AlterTable
ALTER TABLE `water_customers` DROP COLUMN `plot_no`,
    DROP COLUMN `subzone_id`;

-- AlterTable
ALTER TABLE `water_meters` DROP COLUMN `subzone_id`,
    ADD COLUMN `installed_at` DATETIME(3) NULL,
    ADD COLUMN `plot_no` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `water_zones` ADD COLUMN `parent_zone_id` CHAR(36) NULL;

-- DropTable
DROP TABLE `water_subzones`;

-- CreateIndex
CREATE INDEX `water_zones_parent_zone_id_idx` ON `water_zones`(`parent_zone_id`);

-- CreateIndex
CREATE UNIQUE INDEX `water_zones_parent_zone_id_name_key` ON `water_zones`(`parent_zone_id`, `name`);

-- AddForeignKey
ALTER TABLE `water_zones` ADD CONSTRAINT `water_zones_parent_zone_id_fkey` FOREIGN KEY (`parent_zone_id`) REFERENCES `water_zones`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

