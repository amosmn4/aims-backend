-- Why and when a meter left service; its readings and purchases are kept.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'water_meters' AND COLUMN_NAME = 'deactivated_at') = 0,
  'ALTER TABLE `water_meters` ADD COLUMN `deactivated_at` DATETIME(3) NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'water_meters' AND COLUMN_NAME = 'inactive_reason') = 0,
  'ALTER TABLE `water_meters` ADD COLUMN `inactive_reason` ENUM(''replaced'', ''removed'') NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'water_meters' AND COLUMN_NAME = 'inactive_note') = 0,
  'ALTER TABLE `water_meters` ADD COLUMN `inactive_note` VARCHAR(191) NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Inactive meters that already have a successor were replaced.
UPDATE `water_meters` m
  JOIN `water_meters` n ON n.`replaces_meter_id` = m.`id`
  SET m.`inactive_reason` = 'replaced'
  WHERE m.`is_active` = 0 AND m.`inactive_reason` IS NULL;
