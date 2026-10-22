CREATE TABLE `product_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`user_id` int NOT NULL,
	`rating` int NOT NULL,
	`body` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_reviews_user_product_unique` UNIQUE(`product_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `product_videos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`video_url` varchar(2048) NOT NULL,
	`title` varchar(240) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_videos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `product_reviews` ADD CONSTRAINT `product_reviews_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_reviews` ADD CONSTRAINT `product_reviews_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_videos` ADD CONSTRAINT `product_videos_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `product_reviews_product_created_idx` ON `product_reviews` (`product_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `product_videos_product_order_idx` ON `product_videos` (`product_id`,`sort_order`);