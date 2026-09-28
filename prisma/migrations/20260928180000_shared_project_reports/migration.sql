-- Project reports are shared with the team instead of approved.
ALTER TABLE `reports` MODIFY `status` ENUM('draft', 'submitted', 'changes_requested', 'approved', 'shared') NOT NULL DEFAULT 'draft';

-- Swap the unused "project_lead" reviewer for "none", moving any rows across first.
ALTER TABLE `reports` MODIFY `reviewer_kind` ENUM('ceo', 'department_head', 'project_lead', 'none') NOT NULL DEFAULT 'ceo';
UPDATE `reports` SET `reviewer_kind` = 'none' WHERE `reviewer_kind` = 'project_lead';
ALTER TABLE `reports` MODIFY `reviewer_kind` ENUM('ceo', 'department_head', 'none') NOT NULL DEFAULT 'ceo';
