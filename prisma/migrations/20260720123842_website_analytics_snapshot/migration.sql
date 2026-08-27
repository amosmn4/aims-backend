-- CreateTable
CREATE TABLE `website_analytics_snapshots` (
    `id` CHAR(36) NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `visitors` INTEGER NOT NULL,
    `page_views` INTEGER NOT NULL,
    `top_pages` JSON NOT NULL,
    `top_sources` JSON NOT NULL,
    `blog_page_views` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

