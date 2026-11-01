CREATE TABLE `operations_audit_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_admin_user_id` int,
	`actor_type` enum('admin','provisioning_cli') NOT NULL,
	`action` varchar(80) NOT NULL,
	`target_type` varchar(80) NOT NULL,
	`target_id` varchar(80) NOT NULL,
	`details` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `operations_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `operations_audit_events` ADD CONSTRAINT `operations_audit_events_actor_admin_user_id_admin_users_id_fk` FOREIGN KEY (`actor_admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `operations_audit_created_idx` ON `operations_audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `operations_audit_actor_created_idx` ON `operations_audit_events` (`actor_admin_user_id`,`created_at`);