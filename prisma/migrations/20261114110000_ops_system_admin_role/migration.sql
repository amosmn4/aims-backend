ALTER TABLE `ops_staff`
MODIFY `role` ENUM('ceo', 'staff', 'system_admin') NOT NULL DEFAULT 'staff';
