ALTER TABLE "public"."admin_audit_logs" DROP CONSTRAINT IF EXISTS "admin_audit_logs_admin_user_id_fkey";
ALTER TABLE "public"."admin_audit_logs" DROP CONSTRAINT IF EXISTS "admin_audit_logs_admin_user_id_admin_users_id_fk";
ALTER TABLE "public"."admin_audit_logs" ALTER COLUMN "admin_user_id" DROP NOT NULL;
ALTER TABLE "public"."admin_audit_logs"
  ADD CONSTRAINT "admin_audit_logs_admin_user_id_admin_users_id_fk"
  FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
