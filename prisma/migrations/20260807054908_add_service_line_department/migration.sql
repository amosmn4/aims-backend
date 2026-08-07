/*
  Warnings:

  - Added the required column `department_id` to the `service_lines` table without a default value. This is not possible if the table is not empty.

*/
-- These are seed-only reference rows (no invoices/contracts/tenders/client requests exist yet
-- to reference them, all such FKs are SetNull) — safe to clear and let `prisma db seed` recreate
-- them with a department assigned.
DELETE FROM `service_lines`;

-- AlterTable
ALTER TABLE `service_lines` ADD COLUMN `department_id` CHAR(36) NOT NULL;

-- CreateIndex
CREATE INDEX `service_lines_department_id_idx` ON `service_lines`(`department_id`);

-- AddForeignKey
ALTER TABLE `service_lines` ADD CONSTRAINT `service_lines_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
