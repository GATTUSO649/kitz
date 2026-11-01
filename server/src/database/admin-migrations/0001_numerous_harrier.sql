CREATE TABLE `operations_incident_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incident_id` int NOT NULL,
	`actor_admin_user_id` int NOT NULL,
	`event_type` varchar(40) NOT NULL,
	`message` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `operations_incident_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `operations_incidents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incident_number` varchar(24) NOT NULL,
	`severity` enum('P1','P2','P3','P4') NOT NULL,
	`status` enum('open','investigating','resolved','closed') NOT NULL DEFAULT 'open',
	`title` varchar(160) NOT NULL,
	`description` text NOT NULL,
	`affected_component` varchar(80) NOT NULL,
	`created_by_admin_user_id` int NOT NULL,
	`assigned_admin_user_id` int,
	`root_cause` text,
	`resolution_notes` text,
	`detected_at` timestamp NOT NULL DEFAULT (now()),
	`resolved_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `operations_incidents_id` PRIMARY KEY(`id`),
	CONSTRAINT `operations_incidents_incident_number_unique` UNIQUE(`incident_number`)
);
--> statement-breakpoint
CREATE TABLE `operations_operators` (
	`admin_user_id` int NOT NULL,
	`granted_by_admin_user_id` int,
	`granted_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `operations_operators_admin_user_id_pk` PRIMARY KEY(`admin_user_id`)
);
--> statement-breakpoint
ALTER TABLE `operations_incident_events` ADD CONSTRAINT `operations_incident_events_incident_id_operations_incidents_id_fk` FOREIGN KEY (`incident_id`) REFERENCES `operations_incidents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operations_incident_events` ADD CONSTRAINT `operations_incident_events_actor_admin_user_id_admin_users_id_fk` FOREIGN KEY (`actor_admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operations_incidents` ADD CONSTRAINT `operations_incidents_created_by_admin_user_id_admin_users_id_fk` FOREIGN KEY (`created_by_admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operations_incidents` ADD CONSTRAINT `operations_incidents_assigned_admin_user_id_admin_users_id_fk` FOREIGN KEY (`assigned_admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operations_operators` ADD CONSTRAINT `operations_operators_admin_user_id_admin_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operations_operators` ADD CONSTRAINT `operations_operators_granted_by_admin_user_id_admin_users_id_fk` FOREIGN KEY (`granted_by_admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `operations_incident_events_created_idx` ON `operations_incident_events` (`incident_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `operations_incidents_status_created_idx` ON `operations_incidents` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `operations_incidents_severity_created_idx` ON `operations_incidents` (`severity`,`created_at`);--> statement-breakpoint
CREATE INDEX `operations_incidents_assignee_idx` ON `operations_incidents` (`assigned_admin_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `operations_operators_granted_by_idx` ON `operations_operators` (`granted_by_admin_user_id`);