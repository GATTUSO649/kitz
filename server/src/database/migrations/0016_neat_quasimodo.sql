ALTER TABLE `payments` ADD `merchant_request_id` varchar(120);--> statement-breakpoint
ALTER TABLE `payments` ADD `payer_phone` varchar(20);--> statement-breakpoint
ALTER TABLE `payments` ADD `payer_name` varchar(160);--> statement-breakpoint
ALTER TABLE `payments` ADD `transaction_at` datetime;--> statement-breakpoint
ALTER TABLE `payments` ADD `verification_message` varchar(500);