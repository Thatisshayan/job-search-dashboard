CREATE TABLE `bot_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`chatId` varchar(64) NOT NULL,
	`state` enum('awaiting_resume','awaiting_target_titles','awaiting_location','awaiting_radius','idle') NOT NULL DEFAULT 'awaiting_resume',
	`context` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_conversations_chat_unique` UNIQUE(`chatId`)
);
