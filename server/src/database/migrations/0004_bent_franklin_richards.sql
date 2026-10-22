CREATE TABLE `homepage_slides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`image_url` varchar(2048) NOT NULL,
	`title` varchar(180) NOT NULL,
	`subtitle` varchar(500) NOT NULL,
	`promotional_message` varchar(240),
	`cta_label` varchar(80) NOT NULL,
	`destination_url` varchar(2048) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT false,
	`starts_at` timestamp,
	`ends_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `homepage_slides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`public_id` varchar(255) NOT NULL,
	`image_url` varchar(2048) NOT NULL,
	`format` varchar(12) NOT NULL,
	`byte_size` int NOT NULL,
	`width` int,
	`height` int,
	`alt_text` varchar(240) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`is_primary` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_images_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_images_public_id_unique` UNIQUE(`public_id`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `sale_price` decimal(10,2);--> statement-breakpoint
ALTER TABLE `products` ADD `season` varchar(40);--> statement-breakpoint
ALTER TABLE `products` ADD `product_type` varchar(40);--> statement-breakpoint
ALTER TABLE `products` ADD `trending` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `homepage_slides_active_order_idx` ON `homepage_slides` (`active`,`sort_order`);--> statement-breakpoint
CREATE INDEX `product_images_product_order_idx` ON `product_images` (`product_id`,`sort_order`);