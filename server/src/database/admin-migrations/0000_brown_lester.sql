CREATE TABLE `admin_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`admin_user_id` int NOT NULL,
	`action` varchar(100) NOT NULL,
	`target_type` varchar(80),
	`target_id` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`admin_user_id` int NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_sessions_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `admin_setup_locks` (
	`id` int NOT NULL,
	`purpose` varchar(40) NOT NULL,
	CONSTRAINT `admin_setup_locks_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_setup_locks_purpose_unique` UNIQUE(`purpose`)
);
--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(254) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`full_name` varchar(160) NOT NULL,
	`email_verified_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `admin_verification_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`admin_user_id` int NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`consumed_at` timestamp,
	CONSTRAINT `admin_verification_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_verification_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `admin_audit_logs` ADD CONSTRAINT `admin_audit_logs_admin_user_id_admin_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD CONSTRAINT `admin_sessions_admin_user_id_admin_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_verification_tokens` ADD CONSTRAINT `admin_verification_tokens_admin_user_id_admin_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `admin_audit_actor_created_idx` ON `admin_audit_logs` (`admin_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `admin_sessions_user_expiry_idx` ON `admin_sessions` (`admin_user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `admin_verification_user_expiry_idx` ON `admin_verification_tokens` (`admin_user_id`,`expires_at`);