ALTER TABLE `expenses`
  ADD COLUMN `water_category` ENUM('electricity', 'maintenance', 'repairs', 'equipment', 'staff', 'other') NULL;

CREATE INDEX `expenses_water_category_expense_date_idx` ON `expenses`(`water_category`, `expense_date`);
CREATE INDEX `expenses_water_category_status_paid_on_idx` ON `expenses`(`water_category`, `status`, `paid_on`);
