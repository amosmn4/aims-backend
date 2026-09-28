-- A main meter now says which stretch it measures, instead of being found by its
-- name. Names become free text, so a meter can be called the Main Zone Meter.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'water_meters'
      AND COLUMN_NAME = 'main_stage') = 0,
  'ALTER TABLE `water_meters` ADD COLUMN `main_stage` ENUM(''borehole_to_tank'', ''tank_to_network'') NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Fill it in from the names the meters carry today. Matched on the opening word so
-- the arrow character in the old names is never relied on.
UPDATE `water_meters`
SET `main_stage` = 'borehole_to_tank'
WHERE `meter_type` = 'main' AND `main_stage` IS NULL AND `name` LIKE 'Borehole%';

UPDATE `water_meters`
SET `main_stage` = 'tank_to_network'
WHERE `meter_type` = 'main' AND `main_stage` IS NULL AND `name` LIKE 'Tank%';
