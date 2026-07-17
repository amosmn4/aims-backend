-- AlterTable
ALTER TABLE `clients` MODIFY `code` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `budgets` (
    `id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NULL,
    `contract_id` CHAR(36) NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `budgeted_amount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'KES',
    `notes` TEXT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `budgets_department_id_idx`(`department_id`),
    INDEX `budgets_contract_id_idx`(`contract_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_compliance_records` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `period` DATE NOT NULL,
    `filing_type` VARCHAR(191) NOT NULL,
    `due_date` DATE NOT NULL,
    `filed_date` DATE NULL,
    `status` ENUM('pending', 'filed_on_time', 'filed_late', 'overdue') NOT NULL DEFAULT 'pending',
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_compliance_records_client_id_idx`(`client_id`),
    INDEX `payroll_compliance_records_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `debtor_follow_ups` (
    `id` CHAR(36) NOT NULL,
    `invoice_id` CHAR(36) NOT NULL,
    `type` ENUM('reminder_sent', 'promise_to_pay', 'escalated') NOT NULL,
    `channel` VARCHAR(191) NULL,
    `promised_date` DATE NULL,
    `notes` TEXT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `debtor_follow_ups_invoice_id_idx`(`invoice_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `budgets` ADD CONSTRAINT `budgets_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `budgets` ADD CONSTRAINT `budgets_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_compliance_records` ADD CONSTRAINT `payroll_compliance_records_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `debtor_follow_ups` ADD CONSTRAINT `debtor_follow_ups_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
