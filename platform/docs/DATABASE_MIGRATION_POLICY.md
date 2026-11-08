# MarketHub Database Migration Policy

## Ownership and target

MarketHub runs in the existing Supabase PostgreSQL database `postgres`, schema `marketplace`. Kitz owns the existing `public` schema. The Supabase Data API configuration exposes only `public` and `graphql_public`; `marketplace` must remain excluded. Do not edit Kitz migrations, Kitz deployment configuration, `public` objects, API schema exposure, or data as part of a MarketHub release.

The root `supabase/migrations/` directory is shared by Kitz and MarketHub and is not a safe unit for automatic deployment. `platform/server/src/database/marketplace-migrations/` is Drizzle's schema/generation source only. `npm run db:migrate` and `npm run db:migrate:all` inside `platform/` are intentionally blocked. MarketHub workflows may read the Supabase ledger but must not run unrestricted `db push`, `drizzle-kit migrate`, `drizzle-kit push`, `db reset`, or `migration repair`.

## Credentials and permissions

- Runtime: `MARKETPLACE_DATABASE_URL` and `MARKETPLACE_DATABASE_USER` use a dedicated least-privilege role. It may use only the `marketplace` schema and the DML privileges required by the API. It must not be a superuser, create databases/roles, create objects, bypass row security, or have DML access to Kitz `public` relations.
- Preflight: `MARKETHUB_PREFLIGHT_DATABASE_URL` is a read-only role. It may inspect catalog metadata and read the Supabase migration ledger, but must not change rows or schema.
- Migration: `MARKETPLACE_MIGRATION_DATABASE_URL` is a separate Marketplace DDL role. It may create/alter approved objects in `marketplace`, but must not write the Supabase ledger, create or alter objects in `public`, read/write Kitz rows, own Kitz objects, bypass RLS, or have cluster-wide superuser/role/database privileges. `MARKETPLACE_MIGRATION_DATABASE_USER` must match this role.
- TLS: production URLs must use the configured Supabase host and `MARKETPLACE_DATABASE_CA` with certificate verification enabled. Never log URLs or credentials.

The preflight reports `anon`, `authenticated`, and `service_role` access to Marketplace objects. `anon` and `authenticated` must not have Marketplace schema/table access. The service-role result is reported for review; the Express application uses its own runtime role and does not expose Marketplace through the Supabase Data API. Seller posting, public browsing, and admin permissions are additionally exercised through MarketHub API tests; client-side visibility is not an authorization boundary.

## Migration authoring and audit

1. Update `platform/server/src/database/schema.ts` and generate Drizzle SQL with `npm run db:generate` from `platform/`.
2. Review generated SQL and the updated Drizzle snapshot. Preserve payment, callback, seller, and audit records; migrations must be additive/data-preserving unless a separate owner-approved recovery plan says otherwise.
3. Reconcile reviewed SQL into a root Supabase migration with a unique timestamp ID and `markethub_` filename. Never rewrite historical SQL or include `public` operations.
4. Add an explicit entry to `platform/migrations/marketplace-manifest.json` with the exact ID, repository-relative file path, SHA-256, target schema, review/approval status, dependencies, and execution status. The file is intentionally empty until individually reviewed migrations are approved. Do not copy approval metadata from an unverified historical migration.
5. Run `npm run db:marketplace:audit`, the manifest tests, and MarketHub CI. The manifest validator rejects pending IDs absent from the allowlist, checksum changes, duplicate IDs, unknown or forward dependencies, non-Marketplace targets, unsupported/dynamic SQL, and risky/data/permission changes without a separate approval reference.
6. Generate the remote ledger using the read-only preflight role. A pending root migration is eligible only if it is an approved manifest entry and targets only `marketplace`; any pending Kitz/public ID blocks the entire MarketHub release. The Supabase ledger remains read-only. No `db push` dry-run is used to infer an application set because its input directory is shared.
7. Require the exact successful preflight artifact, verified backup/restore reference, a change approval reference, and authorized GitHub environment reviewer approval. Reverify database identity, schema, role privileges, ledger read-only access, manifest checksums, and `public` fingerprint immediately before execution.
8. The direct executor applies only the validated manifest files in one transaction, with `search_path` restricted to `marketplace, pg_catalog`, timeouts set, and `ON_ERROR` causing transaction abort. It records result IDs in a sanitized GitHub artifact and never inserts, updates, or repairs the Supabase ledger. After success, a separate reviewed manifest change must set `executionStatus` to `applied` with evidence before another release can consider that file.
9. Recheck expected Marketplace tables/columns/indexes/FKs/checks, seller terms, role privileges, anonymous/authenticated grants, RLS/policies, and unchanged `public` fingerprint. Deploy Render only after verification. Do not automatically execute destructive rollback SQL.

The SQL validator uses a conservative supported-statement allowlist and is not a general PostgreSQL parser. Unsupported or dynamic SQL fails closed. A checksum and manifest entry do not themselves authorize production: GitHub protected-environment review, target/permission checks, backup evidence, and a successful preflight are still required. Destructive and data-changing SQL needs a separate explicit approval reference and remains subject to human environment approval.

## RLS and access model

The preflight records RLS enabled/forced state and policy names for every Marketplace table. It compares enabled state and policy names with the latest Drizzle snapshot, which currently declares no Marketplace policies; forced state is included in the report for review. The migration audit blocks `ALTER POLICY` because policy edits require separate owner review. It also checks direct `anon`/`authenticated` schema and table grants, service-role access, the Data API schema list, and the runtime role's exact required privileges. It never issues `ALTER ... DISABLE ROW LEVEL SECURITY`, changes grants, or expands Data API schemas. Missing or unexpected security state blocks release for owner review.

The application's public listing and seller-posting routes are Express endpoints with API-level validation/rate limits. CI tests cover public browsing, origin checks, seller signup/consent, and admin authorization failure modes. Supabase service-role access is not a substitute for application authorization.

## Current migration blocker

The audited application schema declares 25 Marketplace tables, while the checked-in root Supabase migration set currently contains no Marketplace table-creation baseline (only an additive seller-terms column migration is Marketplace-qualified). The set also contains historical `public` changes. The initial manifest is empty, so no migration is approved. A database owner must first reconcile the existing Marketplace catalog with the Drizzle schema and both migration records, then approve only exact Marketplace SQL. Do not mark anything applied or replay the Drizzle baseline to make CI green. Existing seller terms column state must be verified before approving or executing the duplicate semantic change in Drizzle and root migration history.