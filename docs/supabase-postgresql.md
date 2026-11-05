# Supabase PostgreSQL Migration Status

**Current state (read-only verification, 2026-11-05):** The Express runtime and Drizzle adapter use PostgreSQL. The connected `public` schema contains 62 base tables and RLS is enabled on all 62. The runtime role has `BYPASSRLS=true`, so RLS is not a containment boundary for the application connection. No grants, roles, schemas, or production rows were changed during verification.

**Data state:** The database is not empty. Aggregate counts observed: 1 user, 7 administrator accounts, 4 orders, 4 payments, 1 product, 4 variants, 4 categories, 1 delivery zone, 1 support request, 4 notifications, and 8 inventory movements. Individual records were not inspected and their provenance is unknown. Do not delete, label, or migrate these rows without a verified backup and record-level reconciliation.

**Migration ledgers:** Supabase records 11 applied migrations through `20261103000010`. The Drizzle tracker contains one initial-baseline marker; this is consistent with the repository's policy that Supabase CLI is the only migration executor, but the live schema has not been fully diffed against all migrations. A remote Supabase dry-run reports `20261105000000_enable_public_rls.sql` as pending; it was not applied. The target is not approved for production cutover.

## Runtime Configuration

Set these only in the server environment or secret manager:

```env
DATABASE_URL=postgresql://<user>:<password>@<supabase-host>:5432/postgres
SUPABASE_CA_CERT_FILE=<path-to-verified-supabase-ca-pem>
# Or, on hosts without a deployed certificate file, set the official PEM as a server-only secret:
SUPABASE_CA_CERT=<official-supabase-ca-pem>
```

The runtime prefers the server-side `SUPABASE_CA_CERT` PEM and otherwise loads `SUPABASE_CA_CERT_FILE` with Node filesystem APIs. It always uses `rejectUnauthorized: true`. For Render, deploy the latest backend code and set `SUPABASE_CA_CERT` from the official CA certificate shown in the Supabase project's Connect/SSL settings; do not set `rejectUnauthorized=false`. Do not add database URLs, CA contents, Supabase keys, or credentials to Vite variables or frontend code. The app does not use Supabase Auth or Edge Functions; existing Express authentication, bcrypt hashes, cookie sessions, authorization, CSRF/origin checks, and payment callbacks remain application-managed.

Do not configure the legacy MySQL source as `DATABASE_URL` while running the PostgreSQL runtime. Keep any source URL in a separate server-only variable for export tooling. Do not expose a Supabase service-role key to the browser.

## Schema and Migration Commands

- `npm run db:supabase:check` performs a TLS-verified, read-only `SELECT 1`.
- `npm run db:supabase:create-schema` creates the PostgreSQL baseline only when `public` is empty; it aborts rather than overwriting existing tables.
- `npm run db:supabase:register-baseline` verifies table, foreign-key, index, and RLS counts, then registers the already-applied baseline in Drizzle's `drizzle` migration history without changing application tables.
- `npm run db:generate` generates future PostgreSQL migrations from both active schemas.
- `npm run db:migrate` is intentionally blocked. Supabase CLI is the only migration executor. Use `npm run db:supabase:dry-run -- --remote` for a non-mutating plan; never push without a verified backup, staging rehearsal, and database-owner approval.
- `npm run db:mysql:generate` and `npm run db:mysql:migrate` use preserved MySQL schemas/configuration for rollback/source work only. Review their target URL before running; never point them at Supabase.

The active PostgreSQL schema files are `server/src/database/schema.ts` and `server/src/database/admin-schema.ts`. Byte-for-byte MySQL schema snapshots are preserved in `schema.mysql.ts` and `admin-schema.mysql.ts`; the original MySQL migration folders and separate Drizzle configs are retained.

## Data Migration Gate

1. Restore MySQL source connectivity without pasting credentials into chat or logs. Test the hostname/DNS and TLS trust from the migration environment.
2. Take a consistent full MySQL backup and restore it into isolated staging. Preserve the production source unchanged.
3. Export/import records in foreign-key order, preserving primary keys, IDs, money precision, timestamps, JSON snapshots, unique values, and password hashes. Do not import provider secrets or change payment state.
4. Compare row counts for every table, unique constraints, foreign-key relationships, sample records, and post-import identity/sequence values.
5. Test customer/admin/operations authentication and session expiry, roles, product/catalogue, checkout, stock contention, orders, duplicate M-Pesa callbacks, financial reporting, notifications, and Cloudinary flows against PostgreSQL.
6. Only after a verified backup, successful staging restore, data reconciliation, and explicit production approval should traffic be switched.

Never mark an unverified migration as applied or run MySQL migrations on PostgreSQL. Keep the MySQL backup and configuration until the PostgreSQL cutover is approved and rollback has been tested. After PostgreSQL receives production writes, switching back to stale MySQL would lose those writes; reconcile them first.

## Verification and Limitations

Verified in the current review: TLS-verified `SELECT 1`; 62 public base tables; RLS enabled on all 62; runtime `BYPASSRLS=true`; aggregate row counts for representative customer/commerce tables; Supabase migration ledger count 11/latest version `20261103000010`; Drizzle history count 1; and a remote Supabase dry-run that listed only `20261105000000_enable_public_rls.sql` without applying it.

Not verified: whether the current rows came from MySQL, fixtures, or later manual/operator actions; full per-table count parity; constraints/index drift; `FORCE ROW LEVEL SECURITY`; exact grants to `anon`/`authenticated`/`service_role`; source backup/restore; production deployment settings; end-to-end PostgreSQL account/order/payment behavior; live email/Cloudinary/Daraja; and rollback after PostgreSQL writes. Do not cut over or automatically clean up data until these gates pass.

Current readiness findings and gates: [production-readiness report](production-readiness-report-2026-11-05.md).
