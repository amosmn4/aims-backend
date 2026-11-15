-- CreateTable
CREATE TABLE `ops_state` (
    `id` VARCHAR(20) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `settings` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_departments` (
    `id` VARCHAR(20) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `blurb` TEXT NOT NULL,
    `modules` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_staff` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `dept` VARCHAR(20) NULL,
    `role` ENUM('ceo', 'staff') NOT NULL DEFAULT 'staff',
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `ops_staff_user_id_key`(`user_id`),
    INDEX `ops_staff_dept_idx`(`dept`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_clients` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `contact` VARCHAR(200) NOT NULL,
    `services` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_projects` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `client` CHAR(36) NULL,
    `lead` CHAR(36) NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `stage` VARCHAR(30) NOT NULL,
    `progress` INTEGER NOT NULL,
    `due` CHAR(10) NOT NULL,
    `summary` TEXT NOT NULL,

    INDEX `ops_projects_client_idx`(`client`),
    INDEX `ops_projects_lead_idx`(`lead`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_project_members` (
    `project_id` CHAR(36) NOT NULL,
    `person_id` CHAR(36) NOT NULL,

    PRIMARY KEY (`project_id`, `person_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_project_departments` (
    `project_id` CHAR(36) NOT NULL,
    `dept_id` VARCHAR(20) NOT NULL,

    PRIMARY KEY (`project_id`, `dept_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_tasks` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `project` CHAR(36) NOT NULL,
    `assignee` CHAR(36) NOT NULL,
    `due` CHAR(10) NOT NULL,
    `priority` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL,

    INDEX `ops_tasks_project_idx`(`project`),
    INDEX `ops_tasks_assignee_idx`(`assignee`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_reports` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `project` CHAR(36) NULL,
    `dept` VARCHAR(20) NOT NULL,
    `author` CHAR(36) NOT NULL,
    `date` CHAR(10) NOT NULL,
    `progress` TEXT NULL,
    `blockers` TEXT NULL,
    `next` TEXT NULL,
    `reviewed` BOOLEAN NOT NULL DEFAULT false,
    `comment` TEXT NULL,

    INDEX `ops_reports_project_idx`(`project`),
    INDEX `ops_reports_dept_date_idx`(`dept`, `date`),
    INDEX `ops_reports_author_idx`(`author`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_report_reviews` (
    `id` CHAR(36) NOT NULL,
    `report_id` CHAR(36) NOT NULL,
    `reviewer_id` CHAR(36) NOT NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ops_report_reviews_report_id_created_at_idx`(`report_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_tenders` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `issuer` VARCHAR(200) NOT NULL,
    `value` DECIMAL(16, 2) NOT NULL,
    `due` CHAR(10) NOT NULL,
    `stage` VARCHAR(30) NOT NULL,
    `notes` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_tender_members` (
    `tender_id` CHAR(36) NOT NULL,
    `person_id` CHAR(36) NOT NULL,

    PRIMARY KEY (`tender_id`, `person_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_client_requests` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `client` CHAR(36) NOT NULL,
    `received` CHAR(10) NOT NULL,
    `handler` CHAR(36) NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `notes` TEXT NULL,

    INDEX `ops_client_requests_handler_idx`(`handler`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_businesses` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `sector` VARCHAR(200) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_business_finance` (
    `id` CHAR(36) NOT NULL,
    `business` VARCHAR(36) NOT NULL,
    `month` CHAR(7) NOT NULL,
    `revenue` DECIMAL(16, 2) NOT NULL,
    `expenses` DECIMAL(16, 2) NOT NULL,
    `note` TEXT NULL,

    UNIQUE INDEX `ops_business_finance_business_month_key`(`business`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_business_grants` (
    `person_id` CHAR(36) NOT NULL,
    `business_id` VARCHAR(36) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,

    PRIMARY KEY (`person_id`, `business_id`, `kind`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_documents` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `folder` VARCHAR(200) NOT NULL,
    `access` VARCHAR(20) NOT NULL,
    `owner` CHAR(36) NOT NULL,
    `updated` CHAR(10) NOT NULL,
    `project` CHAR(36) NULL,
    `dept` VARCHAR(20) NULL,
    `storage_key` VARCHAR(200) NOT NULL,
    `mime` VARCHAR(200) NOT NULL,
    `size` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_document_grants` (
    `document_id` CHAR(36) NOT NULL,
    `person_id` CHAR(36) NOT NULL,

    PRIMARY KEY (`document_id`, `person_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_module_records` (
    `id` CHAR(36) NOT NULL,
    `dept` VARCHAR(20) NOT NULL,
    `module` VARCHAR(200) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `owner` CHAR(36) NOT NULL,
    `date` CHAR(10) NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `notes` TEXT NOT NULL,
    `amount` DECIMAL(16, 2) NULL,

    INDEX `ops_module_records_dept_module_idx`(`dept`, `module`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_templates` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `progress` VARCHAR(200) NOT NULL,
    `blockers` VARCHAR(200) NOT NULL,
    `next` VARCHAR(200) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_invitations` (
    `id` CHAR(36) NOT NULL,
    `staff_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,

    UNIQUE INDEX `ops_invitations_token_hash_key`(`token_hash`),
    INDEX `ops_invitations_staff_id_idx`(`staff_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_sessions` (
    `id` CHAR(36) NOT NULL,
    `staff_id` CHAR(36) NOT NULL,
    `refresh_hash` CHAR(64) NOT NULL,
    `idle_expires_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ops_sessions_refresh_hash_key`(`refresh_hash`),
    INDEX `ops_sessions_staff_id_idx`(`staff_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ops_staff` ADD CONSTRAINT `ops_staff_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_staff` ADD CONSTRAINT `ops_staff_dept_fkey` FOREIGN KEY (`dept`) REFERENCES `ops_departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_projects` ADD CONSTRAINT `ops_projects_client_fkey` FOREIGN KEY (`client`) REFERENCES `ops_clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_projects` ADD CONSTRAINT `ops_projects_lead_fkey` FOREIGN KEY (`lead`) REFERENCES `ops_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_project_members` ADD CONSTRAINT `ops_project_members_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `ops_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_project_members` ADD CONSTRAINT `ops_project_members_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `ops_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_project_departments` ADD CONSTRAINT `ops_project_departments_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `ops_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_project_departments` ADD CONSTRAINT `ops_project_departments_dept_id_fkey` FOREIGN KEY (`dept_id`) REFERENCES `ops_departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_tasks` ADD CONSTRAINT `ops_tasks_project_fkey` FOREIGN KEY (`project`) REFERENCES `ops_projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_tasks` ADD CONSTRAINT `ops_tasks_assignee_fkey` FOREIGN KEY (`assignee`) REFERENCES `ops_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_reports` ADD CONSTRAINT `ops_reports_project_fkey` FOREIGN KEY (`project`) REFERENCES `ops_projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_reports` ADD CONSTRAINT `ops_reports_dept_fkey` FOREIGN KEY (`dept`) REFERENCES `ops_departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_reports` ADD CONSTRAINT `ops_reports_author_fkey` FOREIGN KEY (`author`) REFERENCES `ops_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_report_reviews` ADD CONSTRAINT `ops_report_reviews_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `ops_reports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_report_reviews` ADD CONSTRAINT `ops_report_reviews_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `ops_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_tender_members` ADD CONSTRAINT `ops_tender_members_tender_id_fkey` FOREIGN KEY (`tender_id`) REFERENCES `ops_tenders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_tender_members` ADD CONSTRAINT `ops_tender_members_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `ops_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_client_requests` ADD CONSTRAINT `ops_client_requests_client_fkey` FOREIGN KEY (`client`) REFERENCES `ops_clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_client_requests` ADD CONSTRAINT `ops_client_requests_handler_fkey` FOREIGN KEY (`handler`) REFERENCES `ops_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_business_finance` ADD CONSTRAINT `ops_business_finance_business_fkey` FOREIGN KEY (`business`) REFERENCES `ops_businesses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_business_grants` ADD CONSTRAINT `ops_business_grants_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `ops_staff`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_business_grants` ADD CONSTRAINT `ops_business_grants_business_id_fkey` FOREIGN KEY (`business_id`) REFERENCES `ops_businesses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_documents` ADD CONSTRAINT `ops_documents_owner_fkey` FOREIGN KEY (`owner`) REFERENCES `ops_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_documents` ADD CONSTRAINT `ops_documents_project_fkey` FOREIGN KEY (`project`) REFERENCES `ops_projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_documents` ADD CONSTRAINT `ops_documents_dept_fkey` FOREIGN KEY (`dept`) REFERENCES `ops_departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_document_grants` ADD CONSTRAINT `ops_document_grants_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `ops_documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_document_grants` ADD CONSTRAINT `ops_document_grants_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `ops_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_module_records` ADD CONSTRAINT `ops_module_records_dept_fkey` FOREIGN KEY (`dept`) REFERENCES `ops_departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_module_records` ADD CONSTRAINT `ops_module_records_owner_fkey` FOREIGN KEY (`owner`) REFERENCES `ops_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_invitations` ADD CONSTRAINT `ops_invitations_staff_id_fkey` FOREIGN KEY (`staff_id`) REFERENCES `ops_staff`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ops_sessions` ADD CONSTRAINT `ops_sessions_staff_id_fkey` FOREIGN KEY (`staff_id`) REFERENCES `ops_staff`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
