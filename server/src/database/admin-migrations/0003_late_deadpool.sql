CREATE TABLE `operations_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`operations_user_id` int NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `operations_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `operations_sessions_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `operations_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(254) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`full_name` varchar(160) NOT NULL,
	`disabled_at` timestamp,
	`last_login_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `operations_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `operations_users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `operations_incident_events` DROP FOREIGN KEY `operations_incident_events_actor_admin_user_id_admin_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `operations_incidents` DROP FOREIGN KEY `operations_incidents_created_by_admin_user_id_admin_users_id_fk`;
--> statement-breakpoint
DROP INDEX `operations_audit_actor_created_idx` ON `operations_audit_events`;--> statement-breakpoint
DROP INDEX `operations_incidents_assignee_idx` ON `operations_incidents`;--> statement-breakpoint
ALTER TABLE `operations_audit_events` MODIFY COLUMN `actor_type` enum('admin','operations_user','provisioning_cli') NOT NULL;--> statement-breakpoint
ALTER TABLE `operations_incident_events` MODIFY COLUMN `actor_admin_user_id` int;--> statement-breakpoint
ALTER TABLE `operations_incidents` MODIFY COLUMN `created_by_admin_user_id` int;--> statement-breakpoint
ALTER TABLE `operations_audit_events` ADD `actor_operations_user_id` int;--> statement-breakpoint
ALTER TABLE `operations_incident_events` ADD `actor_operations_user_id` int;--> statement-breakpoint
ALTER TABLE `operations_incidents` ADD `created_by_operations_user_id` int;--> statement-breakpoint
ALTER TABLE `operations_incidents` ADD `assigned_operations_user_id` int;--> statement-breakpoint
ALTER TABLE `operations_sessions` ADD CONSTRAINT `operations_sessions_operations_user_id_operations_users_id_fk` FOREIGN KEY (`operations_user_id`) REFERENCES `operations_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `operations_sessions_user_expiry_idx` ON `operations_sessions` (`operations_user_id`,`expires_at`);--> statement-breakpoint
ALTER TABLE `operations_audit_events` ADD CONSTRAINT `operations_audit_events_actor_operations_user_id_operations_users_id_fk` FOREIGN KEY (`actor_operations_user_id`) REFERENCES `operations_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operations_incident_events` ADD CONSTRAINT `operations_incident_events_actor_operations_user_id_operations_users_id_fk` FOREIGN KEY (`actor_operations_user_id`) REFERENCES `operations_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operations_incident_events` ADD CONSTRAINT `operations_incident_events_actor_admin_user_id_admin_users_id_fk` FOREIGN KEY (`actor_admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operations_incidents` ADD CONSTRAINT `operations_incidents_created_by_operations_user_id_operations_users_id_fk` FOREIGN KEY (`created_by_operations_user_id`) REFERENCES `operations_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operations_incidents` ADD CONSTRAINT `operations_incidents_assigned_operations_user_id_operations_users_id_fk` FOREIGN KEY (`assigned_operations_user_id`) REFERENCES `operations_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operations_incidents` ADD CONSTRAINT `operations_incidents_created_by_admin_user_id_admin_users_id_fk` FOREIGN KEY (`created_by_admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `operations_audit_actor_created_idx` ON `operations_audit_events` (`actor_operations_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `operations_incidents_assignee_idx` ON `operations_incidents` (`assigned_operations_user_id`,`status`);