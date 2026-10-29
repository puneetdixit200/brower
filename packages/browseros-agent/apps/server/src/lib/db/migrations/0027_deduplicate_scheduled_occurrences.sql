CREATE TABLE `scheduled_job_occurrence_claims` (
	`job_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`run_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `scheduled_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_job_occurrence_claims_job_key_unique`
ON `scheduled_job_occurrence_claims` (`job_id`, `occurrence_key`);
--> statement-breakpoint
CREATE INDEX `scheduled_job_occurrence_claims_expires_at_idx`
ON `scheduled_job_occurrence_claims` (`expires_at`);
