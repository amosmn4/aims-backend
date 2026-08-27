-- AlterTable
ALTER TABLE `user_roles` MODIFY `role` ENUM('ceo', 'system_admin', 'finance', 'hr', 'it', 'marketing', 'tender', 'operations', 'department_head', 'account_manager', 'general_staff') NOT NULL;
