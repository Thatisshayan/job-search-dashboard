CREATE TABLE `candidate_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`displayName` varchar(160) NOT NULL,
	`headline` varchar(180) NOT NULL,
	`location` varchar(180) NOT NULL,
	`summary` text NOT NULL,
	`skills` json NOT NULL,
	`experience` json NOT NULL,
	`education` json NOT NULL,
	`scoringGuardrails` json NOT NULL,
	`resumeLabel` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `candidate_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `candidate_profiles_user_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `job_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`jobId` int NOT NULL,
	`status` enum('none','saved','opened','applied','not_interested','reported_stale') NOT NULL DEFAULT 'none',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `job_actions_id` PRIMARY KEY(`id`),
	CONSTRAINT `job_actions_user_job_unique` UNIQUE(`userId`,`jobId`)
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('running','completed','partial','failed') NOT NULL,
	`sourcesChecked` int NOT NULL DEFAULT 0,
	`listingsCollected` int NOT NULL DEFAULT 0,
	`duplicatesMerged` int NOT NULL DEFAULT 0,
	`jobsScored` int NOT NULL DEFAULT 0,
	`shortlistCount` int NOT NULL DEFAULT 0,
	`errorSummary` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `job_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceConfigId` int,
	`sourceName` varchar(120) NOT NULL,
	`sourcePostingUrl` varchar(2048) NOT NULL,
	`originalApplyUrl` varchar(2048),
	`sourceExternalId` varchar(255),
	`fingerprint` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`employer` varchar(255) NOT NULL,
	`location` varchar(255) NOT NULL,
	`locationKm` int,
	`employmentType` varchar(80),
	`description` text NOT NULL,
	`postedAt` timestamp,
	`expiresAt` timestamp,
	`status` enum('active','expired','unavailable','stale') NOT NULL DEFAULT 'active',
	`analysis` json,
	`firstSeenAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `jobs_fingerprint_unique` UNIQUE(`fingerprint`)
);
--> statement-breakpoint
CREATE TABLE `scorecards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`jobId` int NOT NULL,
	`roleAlignment` int NOT NULL,
	`resumeSkillMatch` int NOT NULL,
	`seniorityAlignment` int NOT NULL,
	`locationCommuteFit` int NOT NULL,
	`employmentQualityFit` int NOT NULL,
	`recencyReadiness` int NOT NULL,
	`penalties` int NOT NULL DEFAULT 0,
	`totalScore` int NOT NULL,
	`rationale` text NOT NULL,
	`notableGaps` json NOT NULL,
	`evidence` json NOT NULL,
	`analyzedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scorecards_id` PRIMARY KEY(`id`),
	CONSTRAINT `scorecards_user_job_unique` UNIQUE(`userId`,`jobId`)
);
--> statement-breakpoint
CREATE TABLE `search_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`targetTitles` json NOT NULL,
	`city` varchar(120) NOT NULL DEFAULT 'Toronto, Ontario',
	`radiusKm` int NOT NULL DEFAULT 75,
	`employmentTypes` json NOT NULL,
	`minimumScore` int NOT NULL DEFAULT 60,
	`shortlistLimit` int NOT NULL DEFAULT 20,
	`timezone` varchar(80) NOT NULL DEFAULT 'America/Toronto',
	`scheduledTime` varchar(20) NOT NULL DEFAULT '07:30',
	`schedule_cron_task_uid` varchar(65),
	`dailyNotificationEnabled` boolean NOT NULL DEFAULT true,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `search_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `search_settings_user_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `shortlist_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`runId` int NOT NULL,
	`jobId` int NOT NULL,
	`dateKey` varchar(10) NOT NULL,
	`rank` int NOT NULL,
	`score` int NOT NULL,
	`isNew` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shortlist_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `shortlist_entries_user_date_job_unique` UNIQUE(`userId`,`dateKey`,`jobId`)
);
--> statement-breakpoint
CREATE TABLE `source_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`kind` enum('official','employer','licensed','manual') NOT NULL,
	`baseUrl` varchar(2048),
	`credentialEnvKey` varchar(120),
	`enabled` boolean NOT NULL DEFAULT true,
	`lastStatus` varchar(80),
	`lastCheckedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `source_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('admin','user') NOT NULL DEFAULT 'user';--> statement-breakpoint
CREATE INDEX `job_runs_user_started_idx` ON `job_runs` (`userId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `jobs_status_posted_idx` ON `jobs` (`status`,`postedAt`);--> statement-breakpoint
CREATE INDEX `scorecards_user_score_idx` ON `scorecards` (`userId`,`totalScore`);--> statement-breakpoint
CREATE INDEX `shortlist_entries_user_date_rank_idx` ON `shortlist_entries` (`userId`,`dateKey`,`rank`);--> statement-breakpoint
CREATE INDEX `source_configs_user_idx` ON `source_configs` (`userId`);