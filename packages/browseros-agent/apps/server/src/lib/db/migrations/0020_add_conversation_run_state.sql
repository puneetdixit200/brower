CREATE TABLE `conversation_run_state` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `conversation_run_state_status_idx` ON `conversation_run_state` (`status`);
