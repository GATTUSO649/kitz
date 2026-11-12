ALTER TABLE "admin_users" DROP CONSTRAINT IF EXISTS "admin_users_role_check";
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_check"
  CHECK ("role" IS NULL OR "role" IN (
    'super_admin', 'it_admin', 'sales_admin', 'finance_admin', 'inventory_admin',
    'marketing_admin', 'content_admin', 'second_hand_admin', 'seller_support_admin',
    'marketplace_finance_admin', 'marketplace_moderator', 'laundry_admin'
  ));

INSERT INTO "admin_permissions" ("permission", "description") VALUES
  ('laundry.dashboard.view', 'View Laundry Admin access and dashboard information when the laundry API is available.'),
  ('laundry.bookings.manage', 'Manage laundry bookings when the laundry API is available.'),
  ('laundry.services.manage', 'Manage laundry services and quotations when the laundry API is available.'),
  ('audit.view', 'View administrator audit events and account history.')
ON CONFLICT ("permission") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "admin_role_permissions" ("role", "permission") VALUES
  ('laundry_admin', 'laundry.dashboard.view'),
  ('laundry_admin', 'laundry.bookings.manage'),
  ('laundry_admin', 'laundry.services.manage'),
  ('laundry_admin', 'audit.view')
ON CONFLICT ("role", "permission") DO NOTHING;
