CREATE TABLE `approval_operation_grants` (
	`operation_hash` text PRIMARY KEY NOT NULL,
	`task_hash` text NOT NULL,
	`approval_hash` text NOT NULL,
	`tool_call_hash` text NOT NULL,
	`classification_hash` text NOT NULL,
	`input_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `approval_operation_grants_expiry_idx` ON `approval_operation_grants` (`expires_at`);