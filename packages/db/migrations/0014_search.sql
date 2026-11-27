-- Full-text search (SQLite FTS5). One row per searchable thing; the triggers below keep it current
-- for projects, tasks, comments and boards, so no route has to remember to update it.
-- Card text on boards (notes, column titles, links, files) is written by the Host when a board's
-- live document is stored (see realtime/collab.ts), with kind 'card'.
CREATE VIRTUAL TABLE `search_index` USING fts5(
	`kind` UNINDEXED,
	`ref_id` UNINDEXED,
	`project_id` UNINDEXED,
	`title`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `search_projects_insert` AFTER INSERT ON `projects` BEGIN
	INSERT INTO `search_index` (`kind`, `ref_id`, `project_id`, `title`, `body`)
	VALUES ('project', NEW.`id`, NEW.`id`, NEW.`name`, coalesce(NEW.`client_name`, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `search_projects_update` AFTER UPDATE ON `projects` BEGIN
	DELETE FROM `search_index` WHERE `kind` = 'project' AND `ref_id` = OLD.`id`;
	INSERT INTO `search_index` (`kind`, `ref_id`, `project_id`, `title`, `body`)
	VALUES ('project', NEW.`id`, NEW.`id`, NEW.`name`, coalesce(NEW.`client_name`, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `search_projects_delete` AFTER DELETE ON `projects` BEGIN
	DELETE FROM `search_index` WHERE `kind` = 'project' AND `ref_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `search_tasks_insert` AFTER INSERT ON `tasks` BEGIN
	INSERT INTO `search_index` (`kind`, `ref_id`, `project_id`, `title`, `body`)
	VALUES ('task', NEW.`id`, NEW.`project_id`, NEW.`title`, '');
END;
--> statement-breakpoint
CREATE TRIGGER `search_tasks_update` AFTER UPDATE OF `title`, `project_id` ON `tasks` BEGIN
	DELETE FROM `search_index` WHERE `kind` = 'task' AND `ref_id` = OLD.`id`;
	INSERT INTO `search_index` (`kind`, `ref_id`, `project_id`, `title`, `body`)
	VALUES ('task', NEW.`id`, NEW.`project_id`, NEW.`title`, '');
END;
--> statement-breakpoint
CREATE TRIGGER `search_tasks_delete` AFTER DELETE ON `tasks` BEGIN
	DELETE FROM `search_index` WHERE `kind` = 'task' AND `ref_id` = OLD.`id`;
	DELETE FROM `search_index` WHERE `kind` = 'comment' AND `title` = OLD.`id`;
END;
--> statement-breakpoint
-- A comment keeps the task's id in `title` so it can be removed with the task.
CREATE TRIGGER `search_comments_insert` AFTER INSERT ON `comments` BEGIN
	INSERT INTO `search_index` (`kind`, `ref_id`, `project_id`, `title`, `body`)
	VALUES ('comment', NEW.`id`,
		(SELECT `project_id` FROM `tasks` WHERE `id` = NEW.`task_id`), NEW.`task_id`, NEW.`body`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_comments_update` AFTER UPDATE OF `body` ON `comments` BEGIN
	DELETE FROM `search_index` WHERE `kind` = 'comment' AND `ref_id` = OLD.`id`;
	INSERT INTO `search_index` (`kind`, `ref_id`, `project_id`, `title`, `body`)
	VALUES ('comment', NEW.`id`,
		(SELECT `project_id` FROM `tasks` WHERE `id` = NEW.`task_id`), NEW.`task_id`, NEW.`body`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_comments_delete` AFTER DELETE ON `comments` BEGIN
	DELETE FROM `search_index` WHERE `kind` = 'comment' AND `ref_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `search_boards_insert` AFTER INSERT ON `boards` BEGIN
	INSERT INTO `search_index` (`kind`, `ref_id`, `project_id`, `title`, `body`)
	VALUES ('board', NEW.`id`, NEW.`project_id`, NEW.`title`, '');
END;
--> statement-breakpoint
CREATE TRIGGER `search_boards_update` AFTER UPDATE OF `title`, `project_id` ON `boards` BEGIN
	DELETE FROM `search_index` WHERE `kind` = 'board' AND `ref_id` = OLD.`id`;
	INSERT INTO `search_index` (`kind`, `ref_id`, `project_id`, `title`, `body`)
	VALUES ('board', NEW.`id`, NEW.`project_id`, NEW.`title`, '');
END;
--> statement-breakpoint
CREATE TRIGGER `search_boards_delete` AFTER DELETE ON `boards` BEGIN
	DELETE FROM `search_index` WHERE `kind` = 'board' AND `ref_id` = OLD.`id`;
END;
--> statement-breakpoint
-- Existing data.
INSERT INTO `search_index` (`kind`, `ref_id`, `project_id`, `title`, `body`)
SELECT 'project', `id`, `id`, `name`, coalesce(`client_name`, '') FROM `projects`;
--> statement-breakpoint
INSERT INTO `search_index` (`kind`, `ref_id`, `project_id`, `title`, `body`)
SELECT 'task', `id`, `project_id`, `title`, '' FROM `tasks`;
--> statement-breakpoint
INSERT INTO `search_index` (`kind`, `ref_id`, `project_id`, `title`, `body`)
SELECT 'comment', `id`, (SELECT `project_id` FROM `tasks` WHERE `tasks`.`id` = `comments`.`task_id`), `task_id`, `body`
FROM `comments`;
--> statement-breakpoint
INSERT INTO `search_index` (`kind`, `ref_id`, `project_id`, `title`, `body`)
SELECT 'board', `id`, `project_id`, `title`, '' FROM `boards`;
