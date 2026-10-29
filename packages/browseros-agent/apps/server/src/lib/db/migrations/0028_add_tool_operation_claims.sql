CREATE TABLE `tool_operation_claims` (
	`claim_key` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tool_operation_claims_expires_at_idx` ON `tool_operation_claims` (`expires_at`);
