-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

