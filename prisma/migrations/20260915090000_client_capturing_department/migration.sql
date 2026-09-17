-- AlterTable
ALTER TABLE `clients` ADD COLUMN `department_id` CHAR(36) NULL;

-- CreateIndex
CREATE INDEX `clients_department_id_idx` ON `clients`(`department_id`);

-- AddForeignKey
ALTER TABLE `clients` ADD CONSTRAINT `clients_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

