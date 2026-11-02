ALTER TABLE "operations_operators" ADD COLUMN "it_role" varchar(32);--> statement-breakpoint
ALTER TABLE "operations_operators" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operations_operators" ADD COLUMN "revoked_by_admin_user_id" integer;--> statement-breakpoint
ALTER TABLE "operations_operators" ADD CONSTRAINT "operations_operators_revoked_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("revoked_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operations_operators_active_role_idx" ON "operations_operators" USING btree ("it_role","revoked_at");--> statement-breakpoint
ALTER TABLE "operations_operators" ADD CONSTRAINT "operations_operators_it_role_check" CHECK ("operations_operators"."it_role" IS NULL OR "operations_operators"."it_role" IN ('super_admin', 'security_analyst', 'it_support', 'database_admin', 'infrastructure_admin', 'viewer'));