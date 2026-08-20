CREATE TABLE `applications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`jobId` int NOT NULL,
	`candidateProfileId` int NOT NULL,
	`telegramConnectionId` int,
	`status` enum('drafting','awaiting_telegram_approval','declined','ready_for_final_confirmation','submitted','not_pursuing','expired') NOT NULL DEFAULT 'drafting',
	`testMode` boolean NOT NULL DEFAULT false,
	`reviewPacket` json NOT NULL,
	`approvalNonceHash` varchar(128),
	`approvalExpiresAt` timestamp,
	`telegramMessageId` int,
	`decisionCallbackId` varchar(255),
	`decisionAt` timestamp,
	`finalConfirmationAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `applications_id` PRIMARY KEY(`id`),
	CONSTRAINT `applications_user_job_unique` UNIQUE(`userId`,`jobId`)
);
--> statement-breakpoint
CREATE TABLE `telegram_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`chatId` varchar(64) NOT NULL,
	`botUsername` varchar(128),
	`verifiedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegram_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_connections_user_unique` UNIQUE(`userId`),
	CONSTRAINT `telegram_connections_chat_unique` UNIQUE(`chatId`)
);
--> statement-breakpoint
CREATE INDEX `applications_user_status_idx` ON `applications` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `applications_nonce_idx` ON `applications` (`approvalNonceHash`);