ALTER TABLE `scheduled_jobs` ADD COLUMN `mode` text NOT NULL DEFAULT 'task';
--> statement-breakpoint
ALTER TABLE `scheduled_jobs` ADD COLUMN `conversation_id` text;
--> statement-breakpoint
ALTER TABLE `scheduled_job_runs` ADD COLUMN `conversation_id` text;
