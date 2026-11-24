CREATE TABLE `pin_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`pin_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pin_id`) REFERENCES `pins`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pin_comments_pin_idx` ON `pin_comments` (`pin_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pins` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`number` integer NOT NULL,
	`page` integer NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `deliverable_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pins_version_number_idx` ON `pins` (`version_id`,`number`);