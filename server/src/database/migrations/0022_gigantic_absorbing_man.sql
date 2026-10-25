CREATE TABLE `product_ratings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`visitor_id` varchar(36) NOT NULL,
	`rating` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_ratings_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_ratings_product_visitor_unique` UNIQUE(`product_id`,`visitor_id`)
);
--> statement-breakpoint
ALTER TABLE `product_ratings` ADD CONSTRAINT `product_ratings_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `product_ratings_product_created_idx` ON `product_ratings` (`product_id`,`created_at`);