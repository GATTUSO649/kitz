CREATE TABLE `support_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`support_request_id` int NOT NULL,
	`sender_type` enum('customer','admin') NOT NULL,
	`body` text NOT NULL,
	`latitude` decimal(10,7),
	`longitude` decimal(10,7),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `support_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `support_messages` ADD CONSTRAINT `support_messages_support_request_id_support_requests_id_fk` FOREIGN KEY (`support_request_id`) REFERENCES `support_requests`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `support_messages_request_created_idx` ON `support_messages` (`support_request_id`,`created_at`);
--> statement-breakpoint
INSERT INTO `support_messages` (`support_request_id`, `sender_type`, `body`, `created_at`)
SELECT `id`, 'customer', `message`, `created_at` FROM `support_requests`;
--> statement-breakpoint
INSERT INTO `support_messages` (`support_request_id`, `sender_type`, `body`, `created_at`)
SELECT `id`, 'admin', `admin_response`, `updated_at`
FROM `support_requests`
WHERE `admin_response` IS NOT NULL AND `admin_response` <> '';