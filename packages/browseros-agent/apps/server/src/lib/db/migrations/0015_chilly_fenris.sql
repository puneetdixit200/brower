CREATE TABLE IF NOT EXISTS `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`source_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memories_updated_at_idx` ON `memories` (`updated_at`);
