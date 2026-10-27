CREATE VIRTUAL TABLE IF NOT EXISTS `memories_fts` USING fts5(`memory_id` UNINDEXED, `content`, `source_url`, tokenize='unicode61');--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `memories_fts_insert` AFTER INSERT ON `memories` BEGIN
  INSERT INTO `memories_fts` (`memory_id`, `content`, `source_url`) VALUES (new.`id`, new.`content`, coalesce(new.`source_url`, ''));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `memories_fts_update` AFTER UPDATE ON `memories` BEGIN
  DELETE FROM `memories_fts` WHERE `memory_id` = old.`id`;
  INSERT INTO `memories_fts` (`memory_id`, `content`, `source_url`) VALUES (new.`id`, new.`content`, coalesce(new.`source_url`, ''));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `memories_fts_delete` AFTER DELETE ON `memories` BEGIN
  DELETE FROM `memories_fts` WHERE `memory_id` = old.`id`;
END;
