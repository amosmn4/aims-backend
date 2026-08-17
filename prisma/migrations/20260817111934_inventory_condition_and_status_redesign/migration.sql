-- AlterTable
ALTER TABLE `inventory_items` ADD COLUMN `condition` ENUM('good', 'working', 'needs_attention', 'faulty') NOT NULL DEFAULT 'good',
    MODIFY `status` ENUM('in_use', 'idle') NOT NULL DEFAULT 'in_use';
