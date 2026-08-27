-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('task_due', 'project_alert', 'contract_expiry', 'invoice_overdue', 'tender_deadline', 'meeting', 'reminder', 'task_assigned', 'project_shared', 'document_shared', 'task_comment', 'client_request_assigned') NOT NULL;
