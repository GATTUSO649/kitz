# KitCulture IT Operations Portal

> **Current-state notice (2026-11-05):** This document contains historical MySQL-era migration observations from 2026-11-01. The active runtime is PostgreSQL/Supabase. Follow [Supabase PostgreSQL migration status](supabase-postgresql.md) and the [production-readiness report](production-readiness-report-2026-11-05.md) for current database facts. The old Operations self-signup instructions below are superseded; public signup is disabled.

## Admin-integrated IT Operations (staged)

The `/admin/it` page and `/api/v1/admin/it/*` APIs use the existing administrator session. Access is denied unless an explicit active IT role grant exists in `operations_operators`; no existing administrator or independent Operations user is automatically granted access. The existing `/operations` login, users, sessions, incidents, and audit history remain unchanged during this transition. The initial IT page provides a verified overview, incident create/list/update/timeline, read-only IT audit, and super-admin-only grant management.

IT roles are `super_admin`, `security_analyst`, `it_support`, `database_admin`, `infrastructure_admin`, and `viewer`. The first IT super-admin is an owner-selected, verified administrator and must be explicitly bootstrapped once with `IT_ACCESS_BOOTSTRAP_APPROVED=YES`, `IT_ACCESS_BOOTSTRAP_EMAIL`, and `npm run it:access -- bootstrap-super-admin <same-admin-email>`. Remove those one-shot environment values immediately. Subsequent grants and revocations are available only to an active IT super-admin through `/admin/it`; the last super-admin cannot be downgraded or revoked. Each change writes administrator and Operations audit entries.

The required PostgreSQL migration is generated at `server/src/database/postgres-drizzle-migrations/0001_mean_karnak.sql`. It adds nullable IT role/revocation fields and a constraint/index; it does not backfill existing grant rows. **It has not been applied to any database.** Before rollout, confirm the deployed baseline, backup/restore in staging, review the SQL, apply it through the controlled migration process, then bootstrap only the explicitly selected account. Until migration and bootstrap are complete, `/admin/it` is unavailable and no administrator has IT permissions.

The initial `/admin/it` overview uses current process memory/uptime, shared API request samples, read-only PostgreSQL latency probes, and persisted incident counts. Incidents and audit history reuse existing PostgreSQL tables. Security event ingestion, vulnerability records, support ticketing, provider health, and backup verification are returned as not configured/unknown; the UI does not report fabricated healthy metrics. The API does not expose SQL, shell commands, payment controls, provider credentials, or production configuration changes.

## Scope and trust boundary

The portal is available at `/operations` and has its own login form and API namespace at `/api/v1/operations`. Operations users, password hashes, sessions, and audit records are stored in dedicated tables; sessions use the separate HTTP-only `kc_ops_session` cookie scoped to `/api/v1/operations`. Store-admin credentials and cookies do not authenticate operations requests, and store-admin accounts do not receive operations access automatically. There is no default operator, no fallback to `/admin/login`, and no shared identity table.

The IT sign-in flow is separate from Sales at `/sales-admin/login` (the legacy `/admin/login` redirects). A store-admin account is not an Operations user and does not grant Operations access.

Manage independent operations accounts with `npm run operations:user -- <create|disable|enable|reset-password>`. Set `OPERATIONS_EMAIL` for all actions; `create` also requires `OPERATIONS_NAME` and `OPERATIONS_PASSWORD`, while `reset-password` requires `OPERATIONS_PASSWORD`. The password must satisfy the current 14-character policy and bcrypt byte limit. `disable` and `reset-password` revoke all current operations sessions; `enable` reactivates a disabled account. The CLI writes a provisioning audit event and does not create or modify any store-admin account. These variables are only used by the one-shot CLI, not stored as application runtime secrets.

Public Operations self-signup is disabled. Create independent Operations accounts with the controlled CLI. A one-time Operations Super Admin bootstrap requires `OPERATIONS_BOOTSTRAP_APPROVED=YES` and an exact `OPERATIONS_BOOTSTRAP_EMAIL` match for the existing enabled account; remove those values immediately. Do not expose the bootstrap through HTTP or store the approval values in the deployed runtime environment.

## Data currently collected

- Process health, uptime, Node.js version, RSS memory, and heap usage from the running process.
- Store and administrator database connectivity and a lightweight `SELECT 1` latency probe.
- HTTP request totals, error totals, average and p95 response duration, and the busiest route templates over the last hour.
- Manually created incidents, severity/status updates, assignments to active operations users, root-cause and resolution notes, investigation notes, and append-only incident history.
- Active operations-user roster for incident assignment; disabled accounts are excluded.
- Operations-specific audit events.
- Existing customer conversations remain in the store's support system. The operations console does not authenticate through or navigate into store-admin pages.

Request telemetry is a bounded in-process sample of 5,000 completed requests. It excludes IP addresses, query strings, headers, request bodies, and path parameter values. It resets on process restart and is not shared across instances; it is not a historical or fleet-wide monitoring system. The API refreshes overview data every 30 seconds.

Render, Railway backup verification, Cloudflare, Daraja, and email-provider status show **unknown** because there is no authorized provider telemetry configured. The dashboard does not initiate payments, claim backups succeeded, or infer provider health. There is no AI assistant, automated incident detector, email/Telegram alert dispatcher, or production restart/configuration control in this implementation.

## Safe schema rollout

### Current incident evidence

Read-only production checks on 2026-11-01 observed two different conditions. First, `/health/live` and `/health/ready` returned `200` with both database checks `ok`, while `/api/v1/operations/registration-status` returned `503 OPERATIONS_UNAVAILABLE` with `Operations data is unavailable until its database migration has been applied.` The endpoint selects from `operations_users`, so that response proves the query failed as a missing-table case while the database was reachable. A later check showed `/health/live` `200`, `/health/ready` `503` with both databases `unavailable`, and `/api/v1/operations/registration-status` `503 DATABASE_UNAVAILABLE`; this is a database connectivity outage rather than a migration-only failure. The Operations schema problem and intermittent DB connectivity are separate causes and both must be resolved. Unauthenticated `/api/v1/operations/me` requests returned `401 OPERATIONS_UNAUTHENTICATED`, which is expected without an Operations session. Admin registration status returned `200 available: true`; that only confirms admin signup configuration, not the full admin schema.

After deploying the diagnostics change, missing tables/columns return `503` with `OPERATIONS_SCHEMA_UNAVAILABLE`, message `Operations data is temporarily unavailable because its database schema is incomplete.`, and a `requestId`. Connection/TLS failures in Operations routes return `503 OPERATIONS_DATABASE_UNAVAILABLE`; connection/TLS failures handled by the shared app middleware return `503 DATABASE_UNAVAILABLE`. Both include a request ID. An absent Operations DB configuration returns `503 OPERATIONS_DATABASE_NOT_CONFIGURED`. These client responses never include SQL, stack traces, database URLs, or credentials. Match the request ID to sanitized server logs.

The exact migration that creates `operations_users` and `operations_sessions` is `server/src/database/admin-migrations/0003_late_deadpool.sql`. It follows `0001_numerous_harrier.sql` (legacy incident/operator tables) and `0002_serious_scourge.sql` (audit events), with `0000_brown_lester.sql` creating the base administrator tables. The deployed database's `__drizzle_migrations` rows and live table definitions could not be inspected because no database tool connection was configured and a TLS-verified metadata connection failed with `HANDSHAKE_SSL_ERROR`. Do not infer the applied migration state from `/health/ready` or the Drizzle journal alone.

### Migration history risk

Both store and admin Drizzle configs use MySQL's default `__drizzle_migrations` tracker while maintaining independent journals. Their indices both start at zero and the timestamp ranges overlap. The store journal also has equal `when` timestamps for `0006_lean_anita_blake` and `0007_kit_collections`. All four admin journal tags have matching SQL files, but that does not establish which records are in production. A shared tracker can cause one history to advance past entries in the other history. The `0003` SQL is multi-statement MySQL DDL: MySQL does not make the entire migration transactional, and partial execution can leave tables, columns, or indexes only partly changed. Never rerun it blindly.

### Staging-first execution plan

1. Freeze deploys and scheduled/manual migration jobs. Record the current app release and keep `/health/live` and `/health/ready` results with timestamps.
2. Take a provider snapshot of the entire production database. Also make a consistent logical backup with schema, triggers, routines, and events. Restore that backup to an isolated staging database and verify the restore before using it. Do not use production for rehearsal.
3. With a read-only database account over verified TLS, capture the table/column/index/foreign-key definitions for `operations_*`, `admin_users`, `__drizzle_migrations`, and all tables named in migrations `0000` through `0003`. Capture only migration hashes/timestamps and schema metadata, not customer rows or credentials.
4. Compare the tracker rows to both journals and to the four SQL files. Compare the live schema to `admin-schema.ts`. Specifically check whether `operations_sessions` exists, whether `operations_users` exists, and whether the legacy actor FKs/indexes dropped by `0003` remain or were already changed. Stop if the tracker and schema disagree or if any DDL appears partially applied.
5. On the restored staging clone, test a reviewed forward-only repair plan. `0003_late_deadpool.sql` is the candidate for the missing users/sessions, but only run the full file if all `0001`/`0002` prerequisites and every `0003` precondition are proven present and no statements are partially applied. Otherwise prepare a separately reviewed idempotent reconciliation migration that preserves all existing records. Do not delete/recreate tables or manually advance the tracker to make errors disappear.
6. Apply the approved staging plan once, then verify all columns, indexes, foreign keys, migration records, existing row counts, and the Operations flows. Re-run the plan on a fresh restored clone to prove repeatable release procedure. Capture before/after record counts for affected legacy tables.
7. Only after written database-owner approval, a verified backup, and successful staging restore/test, schedule the same reviewed plan as a controlled production release. Monitor the migration runner and stop on the first unexpected DDL result; do not let API startup run migrations.

Historical MySQL-only inspection SQL from the 2026-11-01 investigation. Do not run these statements against the active PostgreSQL runtime:

```sql
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
    AND (TABLE_NAME LIKE 'operations_%' OR TABLE_NAME IN ('admin_users', '__drizzle_migrations'))
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME LIKE 'operations_%'
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT id, hash, created_at
FROM __drizzle_migrations
ORDER BY created_at, id;

SHOW CREATE TABLE operations_users;
SHOW CREATE TABLE operations_sessions;
SHOW CREATE TABLE operations_incidents;
SHOW CREATE TABLE operations_incident_events;
SHOW CREATE TABLE operations_audit_events;
```

If a table is absent, `SHOW CREATE TABLE` will error; record that absence, do not create it during inspection. Compare tracker hashes against the SHA-256 of each checked-in SQL file and each journal's `when` value. Never modify tracker rows during diagnosis.

No production migration was run during this investigation. Production schema state and the safe execution path remain unverified until the verified-TLS metadata audit and staging rehearsal succeed.

After an approved deployment has applied the admin migrations, create an independent operations account using the CLI above. Confirm it can sign in at `/operations`, that the resulting cookie is `kc_ops_session` with the operations-only path, that a store-admin cookie alone receives 401 from `/api/v1/operations/me`, that an operations cookie alone receives 401 from `/api/v1/admin/me`, and that disabling an operations account revokes its sessions. The operations password is not a store-admin password.

## Current operational playbooks

### Customer authentication or session problem

Detection: customer reports failed sign-in, a session-expiry message, or account APIs return 401/503.

Investigate: reproduce with the affected route, check `/health/ready`, inspect sanitized request IDs and auth logs, and verify customer session-table availability. Never request a password or session cookie.

Approved resolution: confirm account email and configured password-recovery delivery; use the existing password-reset flow. Do not edit session tokens or customer passwords directly in SQL.

Verify and recover: confirm a fresh login and session renewal, then ensure logout revokes the session. Escalate repeated failures across customers as P2; an isolated account issue is P3.

### M-PESA initiation, callback, or pending payment

Detection: STK initiation errors, `requires_review`, or a payment pending beyond the expected customer interaction.

Investigate: use the order number and safe provider request IDs; inspect application logs and payment status. Confirm callback token/path configuration and Daraja environment. Query Safaricom using the existing server-side verification workflow.

Approved resolution: do not mark payments paid manually based on a browser return, screenshot, or callback payload alone. Reconcile with Safaricom records and use existing authenticated administrative procedures. Do not replay a real STK request during diagnosis.

Verify and recover: confirm order, amount, payer, receipt, and final provider status agree. Escalate multiple affected payments or inconsistent financial state as P1/P2.

### MySQL unavailable or slow

Detection: `/health/ready` returns 503, database probes fail, or API responses report temporary database unavailability.

Investigate: inspect sanitized database diagnostics and Render/Railway provider status in their authorized dashboards. Check pool errors, TLS verification, connection limits, and recent deploys. Do not copy credentials or raw SQL into incident notes.

Approved resolution: restore connectivity or correct verified TLS/secret configuration through the hosting console. Do not disable TLS verification or run migrations automatically.

Verify and recover: require readiness to return 200 and verify customer catalogue/account reads. Escalate persistent outage as P1.

### Website or API unavailable

Detection: public health checks fail, Render reports unhealthy deploys, or users report widespread errors.

Investigate: compare `/health/live` and `/health/ready`, inspect deployment logs and recent release changes, and use the hosting dashboard to establish platform status.

Approved resolution: use Render's reviewed rollback/redeploy controls. Do not restart or change production environment variables from this portal.

Verify and recover: confirm HTTPS, the public storefront, API, database readiness, customer login, product browsing, and checkout availability. Escalate outage as P1.

### Email delivery failure

Detection: customer verification/recovery messages fail or provider delivery logs show repeated rejection.

Investigate: inspect the email delivery log's safe error category and provider message ID; check sender verification, SMTP/provider status, and secret configuration in the hosting dashboard.

Approved resolution: correct verified provider settings and retry only through the supported email flow. Do not expose recipient lists or provider credentials in incident notes.

Verify and recover: send one controlled test to an authorized mailbox and confirm provider acceptance/delivery evidence. Escalate broad verification/recovery disruption as P2; isolated delay as P3.

## Required follow-up for production-grade monitoring

- Configure authorized Render, Railway, Cloudflare, Safaricom, and email-provider read-only telemetry credentials in a backend secret manager before enabling those integrations.
- Choose durable, shared metrics storage/collection before relying on multi-instance history. Current metrics are per-process and ephemeral.
- Establish alert thresholds, deduplication, notification destinations, retention, on-call ownership, and a tested delivery path before claiming alerts are active.
- Integrate backup evidence only from provider completion records and periodic restore tests.
- Configure operator access only after migration ordering is reconciled and staging-tested.
- AI analysis/actions are intentionally absent; do not add a model-backed tool until data permissions, secret handling, approval gates, audit retention, and provider credentials have been reviewed.
