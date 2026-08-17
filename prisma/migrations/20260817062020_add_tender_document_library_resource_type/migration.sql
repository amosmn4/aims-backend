-- AlterTable
ALTER TABLE `documents` MODIFY `resource_type` ENUM('project', 'task', 'finance_report', 'tender', 'client_request', 'tender_document_library') NOT NULL;
