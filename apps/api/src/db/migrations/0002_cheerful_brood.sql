CREATE TABLE `analyst_estimates` (
	`company_id` text NOT NULL,
	`period_end` text NOT NULL,
	`metric_id` text NOT NULL,
	`low` text,
	`avg` text,
	`high` text,
	`analyst_count` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`company_id`, `period_end`, `metric_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
