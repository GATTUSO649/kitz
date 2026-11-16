ALTER TABLE "operations_users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "operations_sessions" ADD COLUMN "admin_user_id" integer;--> statement-breakpoint
ALTER TABLE "operations_sessions" ADD COLUMN "admin_session_id" integer;--> statement-breakpoint
ALTER TABLE "operations_users" ADD COLUMN "admin_user_id" integer;--> statement-breakpoint
ALTER TABLE "operations_sessions" ADD CONSTRAINT "operations_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations_sessions" ADD CONSTRAINT "operations_sessions_admin_session_id_admin_sessions_id_fk" FOREIGN KEY ("admin_session_id") REFERENCES "public"."admin_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations_users" ADD CONSTRAINT "operations_users_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operations_sessions_admin_expiry_idx" ON "operations_sessions" USING btree ("admin_user_id","expires_at");--> statement-breakpoint
ALTER TABLE "operations_users" ADD CONSTRAINT "operations_users_admin_user_id_unique" UNIQUE("admin_user_id");--> statement-breakpoint
ALTER TABLE "operations_sessions" ADD CONSTRAINT "operations_sessions_identity_check" CHECK ("operations_sessions"."operations_user_id" IS NOT NULL AND (("operations_sessions"."admin_user_id" IS NULL AND "operations_sessions"."admin_session_id" IS NULL) OR ("operations_sessions"."admin_user_id" IS NOT NULL AND "operations_sessions"."admin_session_id" IS NOT NULL)));