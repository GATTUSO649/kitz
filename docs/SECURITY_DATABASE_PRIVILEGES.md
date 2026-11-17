# Database Privilege Verification

## Report status

**Production verification: NOT RUN.** No production-equivalent runtime, administrator, migration, or read-only audit credentials were available. This document reports the checks implemented in source and the limits of the current evidence; it does not invent actual database role/object values.

| Check | Object scope | Expected permission/state | Actual evidence available | Result | Severity | Remediation |
|---|---|---|---|---|---|---|
| MarketHub runtime identity | Marketplace runtime role | Dedicated role; not superuser, CREATEDB, CREATEROLE, replication, or BYPASSRLS | Preflight SQL checks these role attributes when run with the read-only credential | NOT VERIFIED | Critical | Run approved read-only preflight and review role membership/ownership. |
| MarketHub schema access | `marketplace` and `public` | Marketplace USAGE; no Marketplace CREATE; no public CREATE/DML | Startup and preflight check schema privileges and count public relation DML grants | IMPLEMENTED, NOT LIVE-VERIFIED | High | Run the preflight against production-equivalent runtime role. |
| MarketHub table DML | Required Marketplace tables | Only declared SELECT/INSERT/UPDATE/DELETE privileges | Preflight parses the app's required table/privilege contract and checks required grants | IMPLEMENTED, NOT LIVE-VERIFIED | High | Run preflight; review any missing or excess grants with database owner. |
| MarketHub table ownership | Marketplace tables | Runtime does not own application objects | Not comprehensively checked | NOT IMPLEMENTED | High | Add owner comparisons for all relations and migration/runtime roles. |
| MarketHub sequence access | Marketplace sequences | Runtime has required USAGE and does not own sequences | Preflight checks USAGE and runtime ownership | IMPLEMENTED, NOT LIVE-VERIFIED | High | Run preflight; verify actual sequence ACLs and owner role. |
| MarketHub function execution | Marketplace functions | No unreviewed SECURITY DEFINER or PUBLIC execution path | Not comprehensively checked | NOT IMPLEMENTED | High | Audit function owner, `prosecdef`, EXECUTE ACLs including PUBLIC, and search path. |
| Default privileges | Marketplace/public defaults | Runtime cannot grant/create unintended future objects; no unsafe PUBLIC defaults | Not comprehensively checked | NOT IMPLEMENTED | High | Inspect `pg_default_acl` for runtime/admin/migration owners and PUBLIC grants. |
| Supabase public roles | `anon`, `authenticated`, `service_role` | `anon`/`authenticated` cannot access Marketplace; service-role exposure reviewed | Preflight checks Marketplace schema and product table access; existing MarketHub schema exposure remains limited to public/graphql_public | IMPLEMENTED, NOT LIVE-VERIFIED | High | Run read-only preflight and inspect all relation grants, not only product access. |
| Marketplace RLS | Marketplace tables/policies | Live RLS and policies match approved schema snapshot; runtime cannot bypass RLS | Preflight compares declared RLS/policy state and checks BYPASSRLS role attributes | IMPLEMENTED, NOT LIVE-VERIFIED | High | Run preflight under separate read-only credentials and review every table/policy. |
| Kitz runtime/Admin separation | Kitz and Admin PostgreSQL roles and public objects | Kitz runtime and Admin runtime use separate projects and least-privilege roles; migration identity is separate; no unintended ownership or RLS bypass | Runtime code requires a separate production `ADMIN_DATABASE_URL`; Admin migration config uses a dedicated URL and explicit gates; no live grants/identity were inspected | IMPLEMENTED IN CONFIG / NOT LIVE-VERIFIED | Critical | Verify project IDs, role attributes, grants, ownership, default ACLs, RLS, and policies with approved read-only credentials before cutover. |
| Migration role | Kitz and MarketHub | Separate from runtime; scoped DDL only; no unrelated data/ledger access | MarketHub workflow requires separate runtime/migration identities and allowlisted SQL; Kitz has no equivalent automated verification | PARTIAL | Critical | Verify role attributes, schema/object ownership, grants, and default ACLs before migration. |

## Existing MarketHub preflight

`platform/scripts/database-preflight.mjs` is read-only. It does not issue GRANT/REVOKE/ALTER statements. Its existing checks include:

- Database/host/user/schema identity and verified TLS configuration.
- Superuser, CREATEDB, CREATEROLE, replication, and BYPASSRLS flags.
- Marketplace/public schema access and CREATE privileges.
- Runtime DML grants required by the app and public-schema DML isolation.
- Public relation ownership count, Supabase `anon`/`authenticated` schema/product access, RLS and policy-name drift, and public schema fingerprint.
- Marketplace sequence USAGE and runtime ownership.
- Read-only migration-ledger access for preflight credentials.

It currently does **not** fully verify Marketplace table/schema owners, all Supabase relation grants, Marketplace function execution/security-definer paths, default ACLs, inherited role memberships, or Kitz roles. The preflight was not run because approved read-only database credentials were unavailable.

## Required execution

1. Obtain owner-approved read-only credentials for Kitz store/admin roles and MarketHub runtime/migration roles.
2. Run the existing MarketHub preflight in read-only mode and retain its sanitized JSON report.
3. Implement and review the missing catalog checks before calling the database audit comprehensive.
4. Run all checks against a disposable or production-equivalent database with the exact deployed roles; do not use production for destructive access tests.
5. Any required changes must be delivered as reviewed SQL/migration instructions and approved separately. This audit never modifies grants or schema.
