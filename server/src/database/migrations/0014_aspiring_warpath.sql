CREATE TABLE `notification_campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('order','announcement') NOT NULL,
	`title` varchar(160) NOT NULL,
	`body` text NOT NULL,
	`href` varchar(320),
	`audience_type` enum('all','customer','system') NOT NULL,
	`audience_user_id` int,
	`created_by_admin_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_recipients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaign_id` int NOT NULL,
	`user_id` int NOT NULL,
	`read_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_recipients_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_recipient_campaign_user_unique` UNIQUE(`campaign_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `notification_campaigns` ADD CONSTRAINT `notification_campaigns_audience_user_id_users_id_fk` FOREIGN KEY (`audience_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_recipients` ADD CONSTRAINT `notification_recipients_campaign_id_notification_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `notification_campaigns`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_recipients` ADD CONSTRAINT `notification_recipients_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `notification_campaigns_created_idx` ON `notification_campaigns` (`created_at`);--> statement-breakpoint
CREATE INDEX `notification_recipient_user_read_created_idx` ON `notification_recipients` (`user_id`,`read_at`,`created_at`);