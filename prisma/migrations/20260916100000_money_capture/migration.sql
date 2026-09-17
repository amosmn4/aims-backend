-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `project_id` CHAR(36) NULL,
    ADD COLUMN `void_reason` TEXT NULL,
    ADD COLUMN `voided_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `service_lines` ADD COLUMN `monthly_target` DECIMAL(14, 2) NULL;

-- CreateTable
CREATE TABLE `expenses` (
    `id` CHAR(36) NOT NULL,
    `expense_date` DATE NOT NULL,
    `due_date` DATE NULL,
    `supplier` VARCHAR(191) NULL,
    `description` VARCHAR(191) NOT NULL,
    `category` ENUM('salaries', 'rent', 'utilities', 'software', 'travel', 'marketing', 'subcontractors', 'equipment', 'professional_fees', 'taxes', 'other') NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `currency_code` VARCHAR(3) NOT NULL DEFAULT 'KES',
    `department_id` CHAR(36) NULL,
    `service_line_id` CHAR(36) NULL,
    `project_id` CHAR(36) NULL,
    `status` ENUM('unpaid', 'paid') NOT NULL DEFAULT 'unpaid',
    `paid_on` DATE NULL,
    `reference` VARCHAR(191) NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `expenses_expense_date_idx`(`expense_date`),
    INDEX `expenses_status_due_date_idx`(`status`, `due_date`),
    INDEX `expenses_service_line_id_idx`(`service_line_id`),
    INDEX `expenses_department_id_idx`(`department_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `invoices_project_id_idx` ON `invoices`(`project_id`);

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_service_line_id_fkey` FOREIGN KEY (`service_line_id`) REFERENCES `service_lines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Invoices raised against a contract take its service line when they have none.
UPDATE `invoices` i JOIN `contracts` c ON c.`id` = i.`contract_id`
SET i.`service_line_id` = c.`service_line_id`
WHERE i.`service_line_id` IS NULL AND c.`service_line_id` IS NOT NULL;
