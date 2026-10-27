CREATE TABLE IF NOT EXISTS `email_delivery_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int,
  `order_id` int,
  `notification_type` varchar(64) NOT NULL,
  `recipient_email` varchar(254) NOT NULL,
  `provider_message_id` varchar(128),
  `status` enum('queued','accepted','delivered','rejected','failed') NOT NULL DEFAULT 'queued',
  `attempts` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_attempt_at` timestamp NULL,
  `error_category` varchar(64),
  `error_message` text,
  PRIMARY KEY (`id`),
  KEY `email_delivery_logs_user_created_idx` (`user_id`, `created_at`),
  KEY `email_delivery_logs_order_idx` (`order_id`),
  CONSTRAINT `email_delivery_logs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `email_delivery_logs_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL
);