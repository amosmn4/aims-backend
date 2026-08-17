-- AlterTable
-- Purely additive: `condition` is a brand new column, and `status` gains the new `idle` value
-- while every existing value (in_use, in_storage, under_repair, retired) stays valid — so this
-- is safe to run against a table that already has real rows in any of the old statuses.
ALTER TABLE `inventory_items` ADD COLUMN `condition` ENUM('good', 'working', 'needs_attention', 'faulty') NOT NULL DEFAULT 'good',
    MODIFY `status` ENUM('in_use', 'idle', 'in_storage', 'under_repair', 'retired') NOT NULL DEFAULT 'in_use';
