CREATE TABLE "admin_database_migration_runs" (
	"migration_id" varchar(36) PRIMARY KEY NOT NULL,
	"source_identity" varchar(120) NOT NULL,
	"target_identity" varchar(120) NOT NULL,
	"status" varchar(20) NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" varchar(80),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "admin_database_migration_runs_status_check" CHECK ("admin_database_migration_runs"."status" IN ('in_progress', 'failed', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "admin_database_migration_runs" ENABLE ROW LEVEL SECURITY;