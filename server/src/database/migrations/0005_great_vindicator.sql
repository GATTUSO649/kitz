CREATE TABLE `support_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`order_id` int,
	`category` enum('order','payment','delivery','product','account','other') NOT NULL,
	`subject` varchar(120) NOT NULL,
	`message` text NOT NULL,
	`status` enum('pending','in_progress','resolved','closed') NOT NULL DEFAULT 'pending',
	`admin_response` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `support_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `support_requests` ADD CONSTRAINT `support_requests_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `support_requests` ADD CONSTRAINT `support_requests_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `support_requests_user_created_idx` ON `support_requests` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_requests_status_created_idx` ON `support_requests` (`status`,`created_at`);