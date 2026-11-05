# KitCulture Supabase PostgreSQL Migration Assessment

> **Historical assessment:** This document records the migration implementation and evidence available at the time it was written. Its references to an empty 46-table target and incomplete live ledger are superseded by the read-only verification in [the 2026-11-05 production-readiness report](production-readiness-report-2026-11-05.md). Do not use the historical row-count statements as current database state.

**Status:** PostgreSQL runtime and empty schema are implemented; MySQL data import and production cutover are not complete.  
**Production readiness:** Not ready for a PostgreSQL cutover.

## Objective and Preservation Boundary

Move the database from MySQL to Supabase PostgreSQL while keeping the React/Vite client, Express REST API, authentication model, cookie/session behavior, authorization, payment workflows, Cloudinary integration, and deployment topology unchanged. Supabase Auth and Edge Functions are out of scope. Database secrets must remain server-side.

At the initial assessment stage, no application files were changed. Subsequent implementation switched the active server adapter and Drizzle schemas to PostgreSQL, preserved MySQL schema/config snapshots, and created the Supabase baseline. Guarded connection/setup commands loaded server-side values without printing them. The original MySQL database and records have not been modified.

## Files and Areas Inspected

- Root dependency/scripts manifest: `package.json`; server workspace manifest: `server/package.json`.
- Database configuration and environment validation: `server/src/config/database.ts`, `server/src/config/env.ts`, `server/src/config/database-diagnostics.ts`, and `.env.example`.
- Store and administrator schemas: `server/src/database/schema.ts` and `server/src/database/admin-schema.ts`.
- Store and administrator Drizzle configs, migration journals, SQL migrations, and local database setup: `server/drizzle.config.ts`, `server/drizzle.admin.config.ts`, `server/src/database/migrations/`, `server/src/database/admin-migrations/`, and `server/src/database/local-workbench-setup.sql`.
- Database consumers: account, admin, auth, catalogue, operations, orders, reporting, and administrator/operations provisioning scripts under `server/src/`.
- Session middleware and database health probes: `server/src/middleware/authenticate.ts` and `server/src/app.ts`.
- Local database service and deployment guidance: `docker-compose.yml` and `docs/deployment.md`.
- Existing tests and dependency lockfile were located. Existing tests mock or avoid a live PostgreSQL server; no PostgreSQL integration test environment is configured in the inspected project files.

## Current Architecture

- The active runtime uses Drizzle's PostgreSQL dialect with `pg.Pool`; storefront and administrator schemas share that pool. PostgreSQL TLS verification is always enabled, and `SUPABASE_CA_CERT_FILE` is loaded server-side when configured.
- MySQL dependencies, schema snapshots, migration SQL, and legacy Drizzle configs remain available for source/rollback work. They are not used by the active runtime.
- The store schema has 35 tables; the administrator/operations schema has 11. Together they contain customer data, hashed sessions and tokens, roles, catalogue, inventory, carts, orders, payments, audit records, and operations records.
- Authentication is application-managed. Customer, admin, and operations sessions are stored as hashed-token database rows; bcrypt, cookie flags, session expiry, and Express authorization middleware are independent of Supabase Auth and should be retained.
- API/database consumers are in the account, admin, auth, catalogue, operations, orders, and reporting modules. Health/readiness endpoints and provisioning scripts also use driver-specific pool interfaces.
- The order and payment paths use database transactions, conditional stock updates, idempotency keys, and `FOR UPDATE` locks. PostgreSQL supports the transaction and row-lock concepts, but the result handling and SQL dialect must be adapted and tested under concurrency.

## Required Compatibility Work

| Classification | Required work | Preservation constraint |
| --- | --- | --- |
| REQUIRED | Add the PostgreSQL Drizzle driver and a server-only Supabase connection configuration; configure verified TLS and pooler-compatible behavior. | Never put a database URL or Supabase key in client code or Vite variables. Do not introduce Supabase Auth. |
| REQUIRED | Convert both Drizzle schemas from `mysql-core` to `pg-core`; map generated integer keys, enums, booleans, decimal precision, timestamps, defaults, indexes, and foreign keys. | Preserve table/column names, constraints, and relationship semantics wherever PostgreSQL allows. Verify timestamp timezone interpretation against source data. |
| REQUIRED | Create a clean PostgreSQL baseline migration and a single, explicit PostgreSQL migration history. | Do not replay MySQL SQL or reuse the conflicting MySQL migration tracker on the new database. Retain the MySQL files for rollback. |
| REQUIRED | Replace MySQL-only query/result behavior: `$returningId()`, `affectedRows`, `onDuplicateKeyUpdate`, MySQL duplicate-key codes, and MySQL JSON extraction functions. | Preserve endpoint response shapes, idempotency, exact update-conflict behavior, and JSON-derived guest-order fields. |
| REQUIRED | Adapt database diagnostics and raw pool health checks to PostgreSQL errors and driver APIs. | Keep safe error responses and credential/SQL redaction. |
| REQUIRED | Convert the idempotent seed SQL (`INSERT IGNORE` and `ON DUPLICATE KEY UPDATE`) to PostgreSQL conflict clauses. | Ensure repeated migration/seed execution cannot create duplicates or overwrite operator changes unexpectedly. |
| REQUIRED | Update database environment documentation, migration scripts/configs, lockfile, and deployment instructions. | Keep production secrets server-side and retain the MySQL connection/configuration as a rollback path until explicitly approved for removal. |
| COMPATIBILITY | Add PostgreSQL unit/integration coverage for session persistence, transactions, uniqueness errors, JSON extraction, inventory concurrency, payment callback idempotency, and migration behavior. | Existing API/auth/payment security tests must continue passing; add tests rather than relaxing existing controls. |
| REQUIRED GATE | Create and restore-test a complete source MySQL backup; migrate a staging copy; compare per-table counts, key relationships, monetary values, and timestamps; correct PostgreSQL sequences after import. | Never delete or alter the source database. No production traffic switch until verification and owner approval. |

## Concrete MySQL Dependencies Found

- Both Drizzle configs specify `dialect: 'mysql'`; schema files import `drizzle-orm/mysql-core` and use `mysqlEnum`, auto-increment columns, and MySQL `onUpdateNow()` behavior.
- Multiple handlers depend on `$returningId()` and MySQL update/delete `affectedRows` results. Duplicate-key handling checks `ER_DUP_ENTRY` / errno `1062`.
- Several paths use `onDuplicateKeyUpdate`; PostgreSQL requires explicit conflict targets and `ON CONFLICT` behavior.
- Admin/reporting queries use `JSON_EXTRACT` and `JSON_UNQUOTE` over `delivery_address_snapshot`, currently stored as text. PostgreSQL needs a deliberate JSON/text cast or a compatible JSONB column migration; preserve current response values.
- Seed migrations use `INSERT IGNORE` and `ON DUPLICATE KEY UPDATE`.
- Health checks and shutdown use `mysql2` pool methods. Diagnostics and tests contain MySQL error codes and error wording.
- Local Docker Compose provisions MySQL. It may remain as a legacy/rollback service or be replaced/additionally documented for PostgreSQL, but must not be removed before the rollback decision.

## Migration-History Risk

The checked-in storefront journal lists entries `0000` through `0022`, while `0023_email_delivery_logs.sql` is present in the migrations directory but absent from that journal. The administrator schema has its own four-entry journal. Existing deployment documentation also records that the MySQL histories share Drizzle's default migration tracking table and have chronology conflicts. This must be reconciled against the actual source database's migration table and schema before any migration or import. Do not run `db:migrate:all` against the current MySQL database as part of this migration.

A PostgreSQL migration must use a separate, newly reviewed PostgreSQL baseline/history. The exact deployed schema cannot be inferred safely from checked-in files alone until the live MySQL schema and applied migration records are compared.

## Data, Access, and Verification Blockers

- No source MySQL backup or restored staging copy was created or verified in this assessment.
- Supabase connectivity and a Drizzle read-only query were verified with certificate validation enabled. Credentials and CA contents were not printed.
- The live source schema, migration tracker, row counts, data anomalies, triggers, views, and stored procedures (if any) remain unverified. Checked-in migration SQL shows table/index/constraint work and seed SQL; that does not prove the live database has no additional objects or drift.
- No data import or production cutover was performed. The PostgreSQL baseline and Drizzle baseline registration were applied; `db:migrate` was verified to recognize the baseline without recreating tables.

Required next inputs should be configured locally or in the deployment secret manager, not pasted into chat: a read-only/source-capable MySQL URL for backup and export, a Supabase PostgreSQL URL suitable for migrations (direct or session-pooler connection), and a runtime PostgreSQL URL appropriate to the selected pooler. Confirm a maintenance/cutover window and the database owner's approval before production work. Supabase service-role keys are not needed by this Express application and must not be added to the frontend.

## Safe Execution and Rollback Sequence

1. Keep the current MySQL production release and database unchanged. Create a full consistent MySQL backup and restore it to isolated staging; verify the restore before proceeding.
2. Compare the restored schema and MySQL migration tracker with all checked-in migrations, especially the unjournaled `0023` file and separate administrator history. Inventory any live-only tables, triggers, views, or procedures.
3. Implement and review the PostgreSQL schema/adapter and baseline. This code/schema step is complete for the empty Supabase target; do not treat it as data migration.
4. Copy data from the restored staging source, preserving IDs and timestamps. Validate every table's row count, foreign keys, unique constraints, sequence values, JSON snapshots, decimal totals, and representative session/order/payment records.
5. Run the application and all existing tests against PostgreSQL, plus database integration tests for login/session expiry/logout, role checks, checkout stock contention, and duplicate M-Pesa callbacks. Verify Daraja remains sandbox/mock-only during testing.
6. Obtain approval, freeze writes for the cutover, take a final MySQL backup, perform the final import, verify `/health/ready` and critical flows, and only then switch the server-side runtime URL to Supabase. Do not remove the MySQL backup/configuration.
7. Before PostgreSQL accepts production writes, rollback is to restore the prior MySQL release and URL. After PostgreSQL accepts writes, MySQL is stale; do not simply switch URLs back. Reconcile/export post-cutover PostgreSQL writes or perform an approved recovery plan before rollback to avoid silent order/payment loss.

## Assessment Conclusion

The active runtime and schema have been converted to PostgreSQL while retaining Drizzle, Express APIs, and the existing authentication/security model. The required compatibility work spans the driver/configuration, both schemas, migration history, database result semantics, upserts, JSON SQL, diagnostics, tests, and deployment documentation. Data migration and production cutover remain blocked until the source backup is verified, the deployed MySQL schema/history are inventoried, and data reconciliation succeeds.

No production-readiness claim is made. The active application runtime is PostgreSQL, but the Supabase tables are empty; the original MySQL source remains unchanged and is not reachable from this environment.

## Supabase Schema Setup Update — 2026-11-02

After the initial assessment, a read-only inspection confirmed that the Supabase `public` schema contained zero base tables. A separate PostgreSQL-only baseline migration was applied in a transaction using the configured CA certificate with `rejectUnauthorized: true`. The runner aborts unless the target is PostgreSQL, the CA is valid, and `public` is empty; it rolls back on errors and verifies the resulting table count before commit. The PostgreSQL Drizzle baseline was registered and a subsequent `db:migrate` run did not recreate tables.

Verification found 46 tables, 54 foreign keys, and 113 indexes in `public`. Row-level security is enabled on all 46 tables, with zero policies. No records were imported. The schema contains only the structures represented by the checked-in application schemas; it does not represent a data migration or an application runtime cutover.

The MySQL source remains unverified and unreachable from this environment (`ENOTFOUND` during the latest source connection attempt). No source backup was available or created, and no source records were read or changed. The Express application now uses the PostgreSQL adapter. Do not route production commerce traffic to the empty Supabase schema until the source backup, data import, reconciliation, and end-to-end verification are complete.

**Runtime URL warning:** the active application now requires a PostgreSQL `DATABASE_URL` and will reject MySQL protocols. Preserve the MySQL URL separately for source export and rollback; never point the active PostgreSQL runtime or migration commands at MySQL.

## Runtime Migration Completion Update — 2026-11-02

Implemented: PostgreSQL `pg.Pool`/Drizzle runtime with mandatory verified TLS and optional server-side CA PEM; both active Drizzle schemas converted to PostgreSQL while exact MySQL schema/config snapshots remain; PostgreSQL `RETURNING`, `ON CONFLICT`, unique-violation, JSONB, and SQLSTATE compatibility changes; unified PostgreSQL Drizzle config/history; explicit MySQL rollback commands; updated `.env.example`, README, deployment warning, and migration guide.

Verified: 46 application tables; 54 foreign keys; 113 indexes; RLS enabled on all 46 tables and no client-role policies; Supabase connection check; application Drizzle `products` count read; registered baseline; `db:migrate` no-op; `db:generate` reports no schema changes; TypeScript typecheck; production client/server build; lint (existing React hook warnings only); `npm audit` (0 vulnerabilities); and 95 automated tests.

Still incomplete and production-blocking: no source MySQL backup/restore, no source row inventory, no data import, no per-table count/relation/sequence reconciliation, and no end-to-end PostgreSQL workflow tests against migrated records. The latest MySQL source check failed DNS resolution (`ENOTFOUND`). The Supabase application tables are empty. Production commerce must remain on the verified MySQL release until these steps and a controlled rollback test are complete.
