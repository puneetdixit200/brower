CREATE TABLE `action_policy_rules` (
	`action_id` text PRIMARY KEY NOT NULL,
	`decision` text NOT NULL,
	`expires_at` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT `action_policy_rules_decision_check` CHECK (`decision` IN ('allow', 'ask', 'deny'))
);
