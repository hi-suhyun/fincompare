CREATE TABLE `analyst_targets` (
	`company_id` text NOT NULL,
	`published_at` text NOT NULL,
	`analyst_company` text DEFAULT '' NOT NULL,
	`price_target` text NOT NULL,
	`price_when_posted` text,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`company_id`, `published_at`, `analyst_company`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
