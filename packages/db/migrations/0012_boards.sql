CREATE TABLE `board_items` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`kind` text NOT NULL,
	`child_board_id` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`width` real NOT NULL,
	`height` real NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `board_items_board_idx` ON `board_items` (`board_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_items_child_idx` ON `board_items` (`child_board_id`);--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`is_root` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`trashed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `boards_project_idx` ON `boards` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `boards_one_root_idx` ON `boards` (`project_id`) WHERE is_root = 1;--> statement-breakpoint
-- Back-fill: every existing project gets its root board (new projects get one on first visit).
INSERT INTO `boards` (`id`, `project_id`, `title`, `is_root`, `created_by`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `id`, `name`, 1, `created_by`, `created_at`, `created_at` FROM `projects`;
