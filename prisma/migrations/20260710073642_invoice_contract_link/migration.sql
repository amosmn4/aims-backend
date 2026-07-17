-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `contract_id` CHAR(36) NULL;

-- CreateIndex
CREATE INDEX `invoices_contract_id_idx` ON `invoices`(`contract_id`);

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
