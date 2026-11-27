CREATE TABLE `notification_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`muted` text DEFAULT '[]' NOT NULL,
	`daily_summary` integer DEFAULT false NOT NULL,
	`last_summary_day` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
