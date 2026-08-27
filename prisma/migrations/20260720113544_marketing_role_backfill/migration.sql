-- Backfill: migrate existing user_roles rows and the department record itself from
-- marketing_ops to marketing (step 2 of the widen -> backfill -> narrow rename).
UPDATE `user_roles` SET `role` = 'marketing' WHERE `role` = 'marketing_ops';
UPDATE `departments` SET `code` = 'marketing', `name` = 'Marketing' WHERE `code` = 'marketing_ops';
