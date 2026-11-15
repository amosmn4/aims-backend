CREATE TABLE `ops_module_grants` (
  `staff_id` CHAR(36) NOT NULL,
  `module` ENUM('water', 'blog') NOT NULL,
  `access` ENUM('view', 'manage') NOT NULL,
  PRIMARY KEY (`staff_id`, `module`),
  CONSTRAINT `ops_module_grants_staff_id_fkey` FOREIGN KEY (`staff_id`) REFERENCES `ops_staff`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
