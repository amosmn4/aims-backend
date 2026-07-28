-- Narrow: drop 'marketing_ops' now that no rows reference it (step 3 of the
-- widen -> backfill -> narrow rename).
ALTER TABLE `user_roles` MODIFY `role` ENUM('ceo','system_admin','finance','hr','it','marketing','tender','department_head','account_manager','general_staff') NOT NULL;
