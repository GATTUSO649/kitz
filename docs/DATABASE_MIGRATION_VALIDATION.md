# Database Migration Validation

**Evidence date: 2026-11-16. No database was contacted and no migration was applied.** The local `.env` defines `DATABASE_URL` and `SUPABASE_CA_CERT_FILE`, but their values were not read or used because the target environment is unverified and must not be assumed to be staging. The CA path could not be read during the initial test bootstrap. No dedicated staging/test database variable, `ADMIN_DATABASE_URL`, or `REDIS_URL` was available. Production and staging baselines are unknown from current evidence.

## Migration inventory

| Migration | Source journal order | SQL effects | Result |
| --- | ---: | --- | --- |
| `0013_fearless_wasp.sql` | 13 | Drops and recreates the allowed-role CHECK constraints on `operations_operators.it_role` and `operations_users.role`, adding `chief_security_operator` to both lists. | SQL reviewed offline; not applied or PostgreSQL-parsed. |
| `0014_smiling_nextwave.sql` | 14 | Makes `operations_users.password_hash` nullable; adds nullable `admin_user_id`/`admin_session_id` columns; adds FKs to `admin_users`/`admin_sessions` with `ON DELETE CASCADE`; adds `(admin_user_id, expires_at)` index; unique constraint on `operations_users.admin_user_id`; adds paired-null/present session identity CHECK. | SQL reviewed offline; not applied or PostgreSQL-parsed. |

## Dependency and compatibility analysis

- Drizzle journal order is 0000 through 0014, with 0013 before 0014. Migration 0013 expects the role-check constraints created earlier; 0014 expects the existing Operations/admin tables and referenced primary keys.
- `supabase/migrations` contains the existing baseline and later timestamped migrations through `20261113000002_laundry_delivery_fields.sql`; it does not contain copies of 0013 or 0014. The CLI migration runner used by this repository is Supabase CLI; `npm run db:migrate` is intentionally blocked.
- `0013` is not repeat-safe: dropping a missing constraint or adding an existing one fails. It can fail on existing role values outside the expanded allowlist, including schema drift or manually inserted data.
- `0014` is not repeat-safe: its `ADD COLUMN`, `ADD CONSTRAINT`, and `CREATE INDEX` statements have no idempotency guards. Existing data from an expected baseline has NULL in the new columns and satisfies the paired identity check; a partially applied schema, duplicate non-NULL admin links, orphan references, or a duplicate index/constraint can make it fail.
- The unique constraint allows multiple NULL `admin_user_id` values in PostgreSQL while preventing duplicate linked admin IDs. FKs enforce administrator/source-session existence; cascading deletion invalidates associated bridge rows/sessions. New nullable columns do not backfill or change existing Operations account credentials.
- Under the checked-in source schema, legacy `operations_users.password_hash` values are preserved when made nullable. Existing linked/passwordless rows were not verified in any real database.

## Baseline and staging determination

The checked-in Drizzle journal is local generation metadata, not evidence of the deployed database's migration ledger. A repository note reports a remote ledger only through `20261103000010` as of 2026-11-05; local Supabase migrations now extend through 2026-11-13. This historical snapshot cannot establish the current remote state. Do not assume migrations through 0012 are applied, or compare the current database to historical baseline object counts.

No authorized isolated staging database, PostgreSQL version, schema owner/role, verified backup, restore record, or current ledger output was available. Therefore SQL syntax, PostgreSQL version compatibility, ownership/permissions, actual constraints/indexes, existing row compatibility, before/after record counts, Drizzle drift, and repeat-run behavior have not been verified against a database. No migration command was invoked.

Application exchange is additionally protected by `OPERATIONS_IDENTITY_BRIDGE_ENABLED`, which defaults to `false`; keep it false during migration and schema verification. Enable only after the separate staging and rollout gates succeed.

## Rollback feasibility

- 0013 has a possible forward repair only after all stored roles are compatible with the restored old constraint set. It is not safe to roll back while any Chief Security Operator assignment/projection uses the new value.
- 0014 has no lossless schema-down path under the identity-preservation rule: dropping linked projection rows to restore `password_hash NOT NULL` would destroy identity links. Keep the additive schema and links, disable bridge use in application code, revoke grants, invalidate sessions, and prefer a forward-compatible application rollback. Any future schema contraction requires a separately approved data-preserving design.
- Restore is a disaster-recovery option only after an isolated rehearsal and explicit owner approval; it is not the routine rollback for bridge activation.

## Required validation before staging execution

1. Obtain the actual isolated staging Supabase project, separate staging credentials, CA, owner-approved schema privileges, and supported PostgreSQL version. Prove staging does not resolve to production.
2. Capture `supabase migration list --remote` and read-only catalog evidence for the target staging project. Reconcile every pending local migration, including changes newer than the historical 2026-11-05 ledger note.
3. Verify and restore a staging backup; record the restored baseline and row counts for existing administrators, Operations users/sessions, grants, and audit tables.
4. Produce reviewed Supabase migration files/checksums for 0013 and 0014 only after ordering is resolved. Run a dry-run and inspect the complete pending set; do not allow unrelated pending migrations to slip into the apply.
5. Apply only through the approved staging procedure, then verify every new column, FK, index, unique constraint, and CHECK; validate existing identity and legacy account rows; compare schema and Drizzle output; run database-backed bridge tests.

A successful local typecheck or migration SQL inspection is not database or staging evidence.