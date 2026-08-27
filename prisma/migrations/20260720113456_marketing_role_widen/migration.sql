-- Widen: add 'marketing' alongside the existing 'marketing_ops' so both are valid while we
-- migrate data across (step 1 of a widen -> backfill -> narrow rename, same pattern used this
-- session for TenderStage/ClientRequestStage).
ALTER TABLE `user_roles` MODIFY `role` ENUM('ceo','system_admin','finance','hr','it','marketing_ops','marketing','tender','department_head','account_manager','general_staff') NOT NULL;
