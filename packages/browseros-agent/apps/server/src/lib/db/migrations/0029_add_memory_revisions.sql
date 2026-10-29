CREATE TABLE `memory_revisions` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memory_id` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text,
	`source_id` text,
	`source_title` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_revisions_memory_sequence_idx` ON `memory_revisions` (`memory_id`,`sequence`);