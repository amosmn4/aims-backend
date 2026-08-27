-- AlterTable
ALTER TABLE `projects` ADD COLUMN `sdlc_stage` ENUM('requirements', 'design', 'development', 'testing', 'deployment', 'maintenance') NULL;

