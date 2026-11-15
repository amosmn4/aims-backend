ALTER TABLE `ops_tasks`
  ADD COLUMN `ceo_comment` TEXT NULL;

ALTER TABLE `ops_documents`
  ADD COLUMN `task` CHAR(36) NULL,
  ADD INDEX `ops_documents_task_idx` (`task`),
  ADD CONSTRAINT `ops_documents_task_fkey`
    FOREIGN KEY (`task`) REFERENCES `ops_tasks` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
