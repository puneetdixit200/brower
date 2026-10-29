CREATE TABLE `conversation_human_waits` (
	`conversation_id` text NOT NULL,
	`run_id` text NOT NULL,
	`request_id` text NOT NULL,
	`phase` text NOT NULL CHECK (`phase` IN ('waiting', 'human_completed', 'cancelled', 'interrupted')),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY (`conversation_id`, `run_id`)
);
--> statement-breakpoint
CREATE INDEX `conversation_human_waits_phase_idx` ON `conversation_human_waits` (`phase`);
