CREATE TABLE `conversation_run_trace_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`run_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_json` text NOT NULL,
	CONSTRAINT `conversation_run_trace_events_event_id_unique` UNIQUE(`event_id`)
);
--> statement-breakpoint
CREATE INDEX `conversation_run_trace_events_scope_idx` ON `conversation_run_trace_events` (`conversation_id`,`run_id`,`sequence`);
