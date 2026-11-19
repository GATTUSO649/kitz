# Identity Bridge Architecture

**Status (2026-11-20):** Operations sign-in uses an active, email-verified IT Admin or Super Admin account. No separate Operations password, Chief Security Operator grant, or feature-flag activation is required. Database-backed staging and production schema readiness remain unverified.

## Trust boundary

- Kitz central administrator authentication remains the identity authority. Exchange is mounted behind the existing administrator authentication and permission middleware; it uses the authenticated server-side administrator ID and source-session ID, not request-body identity fields.
- The exchange checks the current `admin_sessions` row, unexpired source session, active and email-verified `admin_users` record, and restricts access to `it_admin` and `super_admin` administrator roles. IT Admin maps to the Operations security role; Super Admin maps to Operations super-admin.
- The Operations cookie is a 32-byte cryptographically random opaque token, HTTP-only, `SameSite=Strict`, scoped to `/api/v1/operations`, and secure in production. Only its SHA-256 hash is stored.
- Each request resolves the token hash to an Operations session and joins the linked central account, Operations projection, and exact source session. Administrator role, account status, email verification, and source-session expiry are rechecked.
- The Operations projection is passwordless (`password_hash` is null) and keyed to the central administrator. Legacy password login rejects linked projections; legacy role editing rejects linked identities. Standalone legacy Operations accounts remain distinct.
- Re-exchange deletes prior Operations sessions for that source session before issuing the replacement. Idle renewal is capped by the source-session expiry. Central session deletion cascades to its linked Operations sessions.
- Operations mutation requests require an allowed client origin. The exchange has a per-central-admin distributed rate limit in addition to the admin API limiter; production startup requires `REDIS_URL` and fails closed on store errors.

## Audit identity

Bridge exchange denial, collision, and success events are attributed to the central administrator and include the source session's database ID. Operations mutations write both the central administrator ID and Operations projection ID for bridged actions; their event details include the source-session database ID. Legacy actions continue to use the Operations-user actor. No session token is written to audit records.

## Data and application isolation

Kitz store, central administrator, Operations, and MarketHub authentication/database boundaries remain separate. The Operations payment inspection endpoint queries Kitz payment data only, rejects the MarketHub selection, and has no payment mutation route. MarketHub's local administrator, seller, payment, and database implementations are not used by the Kitz bridge.

## Deployment verification

1. Reconcile the current remote Supabase migration ledger with the local migration stream; the last checked-in ledger report is historical and cannot establish today's remote state.
2. Validate migrations 0013 and 0014 against a separately provisioned PostgreSQL staging project and verified backup restore.
3. Add reviewed, checksum-verified Supabase migration files in the proper order after that reconciliation. The current `supabase/migrations` directory does not contain copies of 0013/0014.
4. Pass database-backed bridge and legacy-account integration tests in staging, including revocation, rotation, collisions, and audit attribution.
5. Verify distributed limiting with shared Redis across at least two application instances.
6. Verify successful and denied sign-ins for active verified IT Admin, Super Admin, unverified, suspended, and other-role accounts. No separate Operations grant is part of sign-in authorization.

The admin IT page now exposes separate implemented/configured/connected/operational/tested/production-verified values, catalog-derived schema presence, the current central identity and permissions, source-session health, the last recorded successful exchange, and recent bridge events. The runtime cannot verify the Supabase migration ledger, a staging test run, or production verification; those statuses remain explicitly unknown/not verified. Do not treat catalog presence or the frontend action as proof of activation.