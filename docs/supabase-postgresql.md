# Supabase PostgreSQL Migration Status

**Current state:** The Express server and Drizzle adapter use PostgreSQL. The Supabase `public` schema contains the 46 KitCulture tables, 54 foreign keys, and 113 indexes. All 46 tables have RLS enabled and there are no client-role policies. A read-only Drizzle query against `products` succeeded.

**Data state:** No MySQL records have been imported. The MySQL source was not reachable during the migration (`ENOTFOUND`); no source backup was available. Supabase currently has an empty KitCulture schema. This is not a production-ready data migration or cutover.

## Runtime Configuration

Set these only in the server environment or secret manager:

```env
DATABASE_URL=postgresql://<user>:<password>@<supabase-host>:5432/postgres
SUPABASE_CA_CERT_FILE=<path-to-verified-supabase-ca-pem>
```

The runtime loads the CA file with Node filesystem APIs and always uses `rejectUnauthorized: true`. Do not add database URLs, CA contents, Supabase keys, or credentials to Vite variables or frontend code. The app does not use Supabase Auth or Edge Functions; existing Express authentication, bcrypt hashes, cookie sessions, authorization, CSRF/origin checks, and payment callbacks remain application-managed.

Do not configure the legacy MySQL source as `DATABASE_URL` while running the PostgreSQL runtime. Keep any source URL in a separate server-only variable for export tooling. Do not expose a Supabase service-role key to the browser.

## Schema and Migration Commands

- `npm run db:supabase:check` performs a TLS-verified, read-only `SELECT 1`.
- `npm run db:supabase:create-schema` creates the PostgreSQL baseline only when `public` is empty; it aborts rather than overwriting existing tables.
- `npm run db:supabase:register-baseline` verifies table, foreign-key, index, and RLS counts, then registers the already-applied baseline in Drizzle's `drizzle` migration history without changing application tables.
- `npm run db:generate` generates future PostgreSQL migrations from both active schemas.
- `npm run db:migrate` applies pending PostgreSQL migrations. It was verified after baseline registration and did not recreate the existing tables.
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

Verified so far: TLS-verified `SELECT 1`, Drizzle `products` count query, 46 tables, 54 foreign keys, 113 indexes, RLS enabled on all tables, empty application tables, baseline registration/no-op migration, TypeScript typecheck, and 94 automated tests.

Not verified: MySQL backup/restore, data import or row-count parity, PostgreSQL end-to-end account/order/payment workflows, production deployment, or a rollback after PostgreSQL writes. Do not accept production commerce traffic on the empty target until these gates pass.