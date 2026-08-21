-- AlterTable
ALTER TABLE `it_systems` MODIFY `type` ENUM('website', 'internal_system', 'integration', 'client_system', 'infrastructure', 'mobile_app') NOT NULL;
