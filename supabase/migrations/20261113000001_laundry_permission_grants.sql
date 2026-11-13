INSERT INTO "admin_permissions" ("permission", "description") VALUES
  ('laundry.dashboard.view', 'View Laundry operations and financial summaries.'),
  ('laundry.bookings.view', 'View Laundry booking and customer pickup records.'),
  ('laundry.bookings.manage', 'Create and manage Laundry bookings.'),
  ('laundry.payments.view', 'View Laundry payment records and financial reports.'),
  ('laundry.payments.manage', 'Record and correct Laundry customer payments.'),
  ('laundry.services.manage', 'Manage Laundry service areas, services, prices, and quotations.'),
  ('laundry.operations.manage', 'Manage Laundry pickup, processing, delivery, and staff assignments.'),
  ('audit.view', 'View administrator audit events and account history.')
ON CONFLICT ("permission") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "admin_role_permissions" ("role", "permission") VALUES
  ('laundry_admin', 'laundry.dashboard.view'),
  ('laundry_admin', 'laundry.bookings.view'),
  ('laundry_admin', 'laundry.bookings.manage'),
  ('laundry_admin', 'laundry.payments.view'),
  ('laundry_admin', 'laundry.payments.manage'),
  ('laundry_admin', 'laundry.services.manage'),
  ('laundry_admin', 'laundry.operations.manage'),
  ('laundry_admin', 'audit.view')
ON CONFLICT ("role", "permission") DO NOTHING;