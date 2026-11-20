# Admin Database Migration Manifest

## Scope and evidence

This is the source-code inventory for the Admin Supabase cutover. It does not claim that a live database has been inspected, backed up, migrated, or reconciled. The current repository state contains 27 source tables to transfer in `server/src/database/admin-schema.ts`, plus the new destination-only `admin_database_migration_runs` ledger. The initial PostgreSQL DDL and subsequent RLS/ledger changes are generated in `server/src/database/admin-postgres-migrations/`. No source or target database was contacted for this inventory.

The intended cutover is Kitz administrator identity, authorization, security operations, monitoring, incidents, and scanner state from the Kitz PostgreSQL project to the separate Admin PostgreSQL project. Kitz customer and business records remain in Kitz. MarketHub's separate schema and application remain excluded.

## Admin destination table inventory

All 27 tables are copied source-to-destination by name. Preserve primary keys, timestamps, status values, and metadata. No column transformation is currently defined by this source audit. The listed foreign keys are destination-internal dependencies and must remain intact. Exact source and destination row counts must be recorded by the migration runner before cutover; they are currently unknown.

| Source -> destination | Dependencies / foreign keys | Application owners |
| --- | --- | --- |
| `admin_users` -> `admin_users` | Referenced by administrator and Operations tables | `modules/admin/auth.ts`, `modules/admin/ecosystem.ts`, `middleware/authenticate.ts`, `modules/admin/routes.ts` |
| `admin_sessions` -> `admin_sessions` | `admin_user_id` -> `admin_users` | `modules/admin/auth.ts`, `middleware/authenticate.ts`, `modules/admin/routes.ts`, `modules/operations/routes.ts` |
| `admin_verification_tokens` -> same | `admin_user_id` -> `admin_users` | `modules/admin/auth.ts`, `modules/admin/ecosystem.ts` |
| `admin_audit_logs` -> same | `admin_user_id` -> `admin_users` (nullable) | `modules/admin/auth.ts`, `modules/admin/ecosystem.ts`, `modules/admin/routes.ts` |
| `admin_setup_locks` -> same | None | `modules/admin/ecosystem.ts` |
| `admin_permissions` -> same | None | `modules/admin/permissions.ts`, `modules/admin/ecosystem.ts` |
| `admin_role_permissions` -> same | Composite key `(role, permission)`; no FK | `modules/admin/permissions.ts`, `modules/admin/ecosystem.ts` |
| `admin_user_permissions` -> same | `admin_user_id` and `granted_by_admin_user_id` -> `admin_users` | `modules/admin/permissions.ts`, `modules/admin/ecosystem.ts` |
| `admin_invitations` -> same | `admin_user_id` -> `admin_users` | `modules/admin/ecosystem.ts` |
| `admin_login_attempts` -> same | `admin_user_id` -> `admin_users` (nullable) | `modules/admin/auth.ts`, `modules/admin/ecosystem.ts` |
| `operations_users` -> same | `admin_user_id` -> `admin_users` (nullable, unique) | `modules/operations/routes.ts`, `modules/admin/routes.ts`, provisioning scripts |
| `operations_sessions` -> same | `operations_user_id` -> `operations_users`; admin identity/session -> `admin_users`/`admin_sessions` | `modules/operations/routes.ts`, `modules/admin/routes.ts` |
| `operations_operators` -> same | Admin, grantor, and revoker IDs -> `admin_users` | `modules/admin/routes.ts`, `modules/admin/ecosystem.ts` |
| `operations_incidents` -> same | Creator/assignee IDs -> Admin or Operations users | `modules/operations/routes.ts`, `modules/admin/routes.ts` |
| `operations_incident_events` -> same | Incident -> `operations_incidents`; actors -> Admin or Operations users | `modules/operations/routes.ts`, `modules/admin/routes.ts` |
| `operations_audit_events` -> same | Actors -> Admin or Operations users | `modules/operations/routes.ts`, `modules/admin/routes.ts` |
| `monitoring_events` -> same | None | `modules/operations/telemetry-store.ts`, `modules/operations/monitoring-worker.ts`, `modules/operations/routes.ts` |
| `monitoring_detection_rules` -> same | Referenced by `monitoring_alerts` | `modules/operations/monitoring-worker.ts`, `modules/operations/routes.ts` |
| `monitoring_alerts` -> same | Rule -> `monitoring_detection_rules`; source event -> `monitoring_events`; assignee -> `operations_users` | `modules/operations/monitoring-worker.ts`, `modules/operations/routes.ts`, `modules/admin/ecosystem.ts` |
| `monitoring_detection_history` -> same | None | `modules/operations/monitoring-worker.ts` |
| `monitoring_worker_state` -> same | None | `modules/operations/monitoring-worker.ts`, `modules/security/scheduled-scanner.ts`, `modules/operations/routes.ts` |
| `security_scans` -> same | Requesting actors -> Operations or Admin users | `modules/security/scanner-engine.ts`, `modules/security/scanner-persistence.ts`, `modules/operations/routes.ts` |
| `security_scan_modules` -> same | `scan_id` -> `security_scans` | `modules/security/scanner-engine.ts`, `modules/security/scanner-persistence.ts` |
| `security_findings` -> same | `scan_module_id` -> `security_scan_modules` | `modules/security/scanner-engine.ts`, `modules/security/scanner-persistence.ts`, `modules/operations/routes.ts` |
| `security_finding_events` -> same | Finding -> `security_findings`; actor -> `operations_users` (nullable) | `modules/security/scanner-engine.ts`, `modules/operations/routes.ts` |
| `security_scanner_health` -> same | None | `modules/security/scanner-engine.ts` |
| `security_scan_schedules` -> same | None | `modules/security/scheduled-scanner.ts`, `modules/operations/routes.ts` |
| `admin_database_migration_runs` -> create new; do not copy | Destination-only migration identity, status, and reconciliation summary; RLS enabled | `server/scripts/migrate-admin-data.mjs` |

### Transfer handling

- Preserve administrator password hashes only; never export plaintext credentials.
- Preserve invitation and verification token hashes and their lifecycle timestamps; never export raw tokens. Expired/consumed rows remain historical records.
- Session tables contain only token hashes. They require a documented security decision before transfer. Default cutover behavior is to invalidate active Admin and Operations sessions and record source/target counts, because session revocation is safer than silently extending credentials across a project boundary.
- Preserve IDs and reset destination identity sequences after copying.
- Copy in dependency order, then validate every FK, unique constraint, and count. Duplicate or rejected rows must stop cutover and be reported, not silently skipped.
- The cutover runner must write a reconciliation report for every table with source count, target count, inserted, already-present, rejected, and verification outcome.

## Kitz-owned records that reference administrator actions

These records remain in Kitz because they are part of business workflows. They are not copied to the Admin project. Their actor IDs are historical references, not cross-project foreign keys.

| Kitz tables / fields | Business owner and behavior | Boundary treatment |
| --- | --- | --- |
| `notification_campaigns.created_by_admin_id` | Kitz admin notification management | Retain Kitz row and actor ID; no Admin FK is declared. |
| `payment_refunds.created_by_admin_id`, `resolved_by_admin_id` | Refund requests and payment/order updates in `modules/admin/workflows.ts` | Retain in Kitz; log corresponding action in Admin audit. |
| `payment_reconciliations.reconciled_by_admin_id` | Kitz payment reconciliation in `modules/admin/workflows.ts` | Retain in Kitz; log corresponding action in Admin audit. |
| `laundry_service_areas.created_by_admin_id` | Laundry service-area management in `modules/laundry/routes.ts` | Retain actor ID; drop the cross-database FK. |
| `laundry_booking_events.actor_admin_user_id`, `laundry_payment_events.actor_admin_user_id` | Laundry lifecycle/payment audit in `modules/laundry/routes.ts` | Retain actor ID and history; drop cross-database FKs. |
| `laundry_payments.recorded_by_admin_id` | Laundry payment records in `modules/laundry/routes.ts` | Retain actor ID and payment row; drop cross-database FK. |
| `inventory_purchase_orders.created_by_admin_id`, `approved_by_admin_id`; `inventory_returns.created_by_admin_id`, `resolved_by_admin_id` | Inventory workflows in `modules/admin/workflows.ts` | Retain in Kitz; audit corresponding administrative actions in Admin database. |
| `marketing_coupons.created_by_admin_id`, `marketing_email_campaigns.created_by_admin_id` | Kitz marketing workflows in `modules/admin/workflows.ts` | Retain Kitz business rows; audit corresponding administrative actions in Admin database. |

`laundry_booking_events`, `laundry_payment_events`, `laundry_payments`, and `laundry_service_areas` currently have four foreign keys to Kitz `admin_users`. The new Kitz migration `20261117000000_admin_database_boundary.sql` removes only those constraints and preserves all actor columns and data.

Administrator-facing reports and workflows that query customers, products, orders, payments, inventory, laundry, or site settings continue to execute in the Kitz backend against `DATABASE_URL`. Admin identity, access, and audit data use `ADMIN_DATABASE_URL`. MarketHub's `platform/server` connection remains `MARKETPLACE_DATABASE_URL` and its own marketplace schema; it is not part of this migration.

## Not present in the current database schema

The repository does not currently define persistent tables for MFA enrollment/recovery, device trust, threat-intelligence feeds/indicators, bot-protection records, or administrative notification/configuration registries beyond the tables listed above. Persistent administrator-database IP/CIDR policies are implemented by `waf_ip_policies`; biometric recovery is implemented by `admin_biometric_recovery_requests`. The current IP policy implementation is in-memory. These are implementation gaps, not source tables that can be copied. Add and migrate them as separate approved schema work before claiming those capabilities are persistent in Admin Supabase.

## Live migration gates

No live source/target project IDs, backup, role grants, PostgreSQL version, extension inventory, RLS/grant state, or row counts are verified here. Do not run Admin migrations or data transfer until the source and target project identities are explicitly matched to approved IDs, the target is proven separate, a verified backup and staging restore exist, and the complete dry-run is reviewed. Do not drop any source administrator tables as part of this cutover.