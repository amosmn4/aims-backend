-- CreateIndex
CREATE INDEX `contracts_status_end_date_idx` ON `contracts`(`status`, `end_date`);

-- CreateIndex
CREATE INDEX `invoices_status_due_date_idx` ON `invoices`(`status`, `due_date`);
