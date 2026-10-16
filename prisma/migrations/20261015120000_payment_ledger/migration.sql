-- CreateTable
CREATE TABLE `payment_ledger_entries` (
    `id` CHAR(36) NOT NULL,
    `receipt` VARCHAR(64) NOT NULL,
    `paybill` VARCHAR(32) NOT NULL,
    `reference` VARCHAR(64) NOT NULL,
    `amount` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(3) NOT NULL,
    `direction` VARCHAR(3) NOT NULL,
    `channel` VARCHAR(10) NOT NULL,
    `payment_status` VARCHAR(12) NOT NULL,
    `processing_status` VARCHAR(12) NOT NULL,
    `destination` VARCHAR(12) NOT NULL,
    `system_name` VARCHAR(100) NOT NULL,
    `application_code` VARCHAR(50) NULL,
    `payer_name` VARCHAR(255) NOT NULL,
    `payer_phone` VARCHAR(64) NOT NULL,
    `requires_review` BOOLEAN NOT NULL,
    `transaction_at` DATETIME(3) NULL,
    `received_at` DATETIME(3) NOT NULL,
    `source_sequence` BIGINT NOT NULL,
    `snapshot` JSON NOT NULL,
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_ledger_entries_receipt_key`(`receipt`),
    INDEX `payment_ledger_entries_received_at_id_idx`(`received_at`, `id`),
    INDEX `payment_ledger_entries_destination_processing_status_idx`(`destination`, `processing_status`),
    INDEX `payment_ledger_entries_system_name_currency_direction_idx`(`system_name`, `currency`, `direction`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_ledger_sync` (
    `id` VARCHAR(40) NOT NULL,
    `lease_token` CHAR(36) NULL,
    `lease_until` DATETIME(3) NULL,
    `last_success_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

