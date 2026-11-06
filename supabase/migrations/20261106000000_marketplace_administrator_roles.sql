ALTER TABLE "admin_users" DROP CONSTRAINT IF EXISTS "admin_users_role_check";
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_check"
  CHECK ("role" IS NULL OR "role" IN (
    'super_admin', 'it_admin', 'sales_admin', 'finance_admin', 'inventory_admin',
    'marketing_admin', 'content_admin', 'second_hand_admin', 'seller_support_admin',
    'marketplace_finance_admin', 'marketplace_moderator'
  ));

INSERT INTO "admin_permissions" ("permission", "description") VALUES
  ('marketplace.dashboard.read', 'View MarketHub marketplace operations.'),
  ('marketplace.listings.read', 'View marketplace listings for support and moderation.'),
  ('marketplace.listings.manage', 'Manage marketplace listings.'),
  ('marketplace.categories.manage', 'Manage marketplace categories.'),
  ('marketplace.finance.read', 'View MarketHub payment and revenue records.'),
  ('marketplace.finance.reconcile', 'Reconcile MarketHub payments.'),
  ('marketplace.support.manage', 'Manage marketplace seller support requests.'),
  ('marketplace.moderation.manage', 'Review and moderate marketplace listings and reports.'),
  ('marketplace.settings.manage', 'Manage MarketHub marketplace settings.')
ON CONFLICT ("permission") DO UPDATE SET "description" = EXCLUDED."description";