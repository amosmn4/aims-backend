-- Water that left the network for a known reason — charging a 6-inch main after a
-- repair, flushing, a burst — so it is never reported as unexplained loss.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'water_network_adjustments') = 0,
  'CREATE TABLE `water_network_adjustments` (
     `id` CHAR(36) NOT NULL,
     `zone_id` CHAR(36) NULL,
     `occurred_at` DATE NOT NULL,
     `units` DECIMAL(12, 2) NOT NULL,
     `kind` ENUM(''line_fill'', ''flushing'', ''burst_repair'', ''other'') NOT NULL DEFAULT ''line_fill'',
     `note` VARCHAR(300) NULL,
     `created_by` CHAR(36) NULL,
     `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     INDEX `water_network_adjustments_occurred_at_idx`(`occurred_at`),
     INDEX `water_network_adjustments_zone_id_occurred_at_idx`(`zone_id`, `occurred_at`),
     PRIMARY KEY (`id`)
   ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'water_network_adjustments'
      AND CONSTRAINT_NAME = 'water_network_adjustments_zone_id_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `water_network_adjustments` ADD CONSTRAINT `water_network_adjustments_zone_id_fkey` FOREIGN KEY (`zone_id`) REFERENCES `water_zones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
