CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`mentions` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comments_task_idx` ON `comments` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `task_history` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`event` text NOT NULL,
	`data` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_history_task_idx` ON `task_history` (`task_id`,`at`);