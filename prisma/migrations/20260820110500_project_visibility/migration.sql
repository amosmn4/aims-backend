-- AlterTable
ALTER TABLE `projects` ADD COLUMN `visibility` ENUM('department', 'restricted') NOT NULL DEFAULT 'department';
