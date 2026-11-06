ALTER TABLE "admin_users" DROP CONSTRAINT IF EXISTS "admin_users_status_check";
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_status_check"
  CHECK ("status" IN ('pending', 'active', 'suspended', 'disabled', 'rejected'));