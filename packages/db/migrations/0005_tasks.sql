CREATE TABLE `subtasks` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`sort_key` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subtasks_task_idx` ON `subtasks` (`task_id`);--> statement-breakpoint
CREATE TABLE `task_assignees` (
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `user_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_assignees_user_idx` ON `task_assignees` (`user_id`);--> statement-breakpoint
CREATE TABLE `task_files` (
	`task_id` text NOT NULL,
	`file_id` text NOT NULL,
	`added_by` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `file_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_files_file_idx` ON `task_files` (`file_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`start_at` integer,
	`due_at` integer,
	`sort_key` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_id`) REFERENCES `task_statuses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_project_idx` ON `tasks` (`project_id`,`status_id`,`sort_key`);