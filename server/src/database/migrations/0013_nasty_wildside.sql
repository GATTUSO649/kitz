ALTER TABLE `support_messages` ADD `product_name` varchar(180);--> statement-breakpoint
ALTER TABLE `support_messages` ADD `product_price` decimal(12,2);--> statement-breakpoint
ALTER TABLE `support_messages` ADD `product_image_url` text;--> statement-breakpoint
ALTER TABLE `support_messages` ADD `product_url` varchar(320);