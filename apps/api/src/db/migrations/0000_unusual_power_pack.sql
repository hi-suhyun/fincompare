CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`country` text NOT NULL,
	`market` text NOT NULL,
	`name_ko` text,
	`name_en` text,
	`corp_code` text,
	`stock_code` text,
	`cik` text,
	`ticker` text,
	`fiscal_year_end_month` integer NOT NULL,
	`is_adr` integer DEFAULT false NOT NULL,
	`is_supported` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_companies_name_ko` ON `companies` (`name_ko`);--> statement-breakpoint
CREATE INDEX `idx_companies_name_en` ON `companies` (`name_en`);--> statement-breakpoint
CREATE INDEX `idx_companies_ticker` ON `companies` (`ticker`);--> statement-breakpoint
CREATE INDEX `idx_companies_stock_code` ON `companies` (`stock_code`);--> statement-breakpoint
CREATE INDEX `idx_companies_corp_code` ON `companies` (`corp_code`);--> statement-breakpoint
CREATE INDEX `idx_companies_cik` ON `companies` (`cik`);--> statement-breakpoint
CREATE TABLE `company_aliases` (
	`company_id` text NOT NULL,
	`alias` text NOT NULL,
	`chosung` text,
	`alias_type` text NOT NULL,
	PRIMARY KEY(`company_id`, `alias`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_aliases_alias` ON `company_aliases` (`alias`);--> statement-breakpoint
CREATE INDEX `idx_aliases_chosung` ON `company_aliases` (`chosung`);--> statement-breakpoint
CREATE TABLE `fetch_log` (
	`source` text NOT NULL,
	`cache_key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`error_kind` text,
	`attempted_at` text NOT NULL,
	`revalidate_after` text
);
--> statement-breakpoint
CREATE INDEX `idx_fetch_log_source` ON `fetch_log` (`source`);--> statement-breakpoint
CREATE TABLE `financial_facts` (
	`company_id` text NOT NULL,
	`metric_id` text NOT NULL,
	`period_type` text NOT NULL,
	`period_start` text,
	`period_end` text NOT NULL,
	`fiscal_year` integer NOT NULL,
	`fiscal_quarter` integer,
	`aligned_year` integer NOT NULL,
	`aligned_quarter` integer,
	`value` text,
	`currency` text NOT NULL,
	`consolidation` text NOT NULL,
	`source` text NOT NULL,
	`source_tag` text NOT NULL,
	`filed_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `metric_id`, `period_type`, `period_end`, `consolidation`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_facts_lookup` ON `financial_facts` (`company_id`,`period_type`,`aligned_year`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`date` text NOT NULL,
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` text NOT NULL,
	PRIMARY KEY(`date`, `base`, `quote`)
);
--> statement-breakpoint
CREATE TABLE `prices` (
	`company_id` text NOT NULL,
	`date` text NOT NULL,
	`close` text NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`company_id`, `date`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `raw_cache` (
	`source` text NOT NULL,
	`cache_key` text PRIMARY KEY NOT NULL,
	`payload` blob NOT NULL,
	`etag` text,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_raw_cache_expires` ON `raw_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `shares_outstanding` (
	`company_id` text NOT NULL,
	`period_end` text NOT NULL,
	`issued` text,
	`treasury` text,
	`outstanding` text,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `period_end`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
