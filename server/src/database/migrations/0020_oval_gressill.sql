ALTER TABLE `orders` ADD `idempotency_key` varchar(36);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_idempotency_key_unique` UNIQUE(`idempotency_key`);