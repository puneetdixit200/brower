CREATE TABLE IF NOT EXISTS `memory_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`retention_days` integer,
	`updated_at` integer NOT NULL
);
