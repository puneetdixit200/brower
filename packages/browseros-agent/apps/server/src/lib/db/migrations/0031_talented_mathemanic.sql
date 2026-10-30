CREATE TABLE `conversation_run_text_checkpoints` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	CONSTRAINT "conversation_run_text_checkpoints_text_bytes_check" CHECK(length(CAST("conversation_run_text_checkpoints"."text" AS BLOB)) <= 16384)
);
