CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`priority` integer DEFAULT 5 NOT NULL,
	`color` text DEFAULT 'yellow' NOT NULL,
	`created_at` text NOT NULL,
	`reviewed_at` text
);
--> statement-breakpoint
CREATE INDEX `ideas_reviewed_category_idx` ON `ideas` (`reviewed_at`,`category`);