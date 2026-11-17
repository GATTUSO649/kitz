# Phase 4 Security Report

**Assessment date: 2026-11-16. Production readiness: NOT VERIFIED.** This report distinguishes source review and local automated checks from database, staging, and production evidence.

## A. Executive summary

Completed an offline review of Kitz central administrator authentication, the Operations identity bridge, role policy, session handling, migrations 0013/0014, migration workflow, audit writes, rate limiting, and the separate MarketHub project. Fixed three verified code issues: bridged access now requires an active and email-verified central account on every request; bridged Operations audits and incident events retain both actor identities and the source-session database reference; and unsupported non-read Operations verbs fail closed instead of inheriting read permissions.

No PostgreSQL migration, database-backed integration test, staging test, Redis multi-instance test, or production verification was performed. Phase 4 is not complete.

## B. Changes implemented

- `server/src/modules/operations/routes.ts`: rechecks active/verified central account state on every bridged request; carries source admin-session ID into request context; central administrator/source-session attribution for bridged Operations audit and incident events.
- `server/src/modules/admin/routes.ts`: includes source-session database ID in exchange denial, identity-conflict, and success audit details; adds an account-keyed shared Redis exchange limiter, no-store handling, and read-only catalog/identity status API. No bearer token is stored.
- `server/src/config/env.ts` and `.env.example`: add explicit `OPERATIONS_IDENTITY_BRIDGE_ENABLED`, defaulting to `false`; migrations cannot activate the bridge without a separate approved configuration change.
- `server/src/modules/admin/it-access.ts`: unmatched or unsupported write methods no longer inherit read permission.
- `server/src/modules/auth/routes.test.ts`: adds inactive-status, bridged/legacy audit attribution, and unsupported-write permission assertions.
- `server/src/app.test.ts` and `src/pages/AdminPages.tsx`: guard the status endpoint and render distinct bridge lifecycle states without implying staging/production verification.
- Added architecture, security test, migration validation, rollout, rollback, and Phase 4 report documents under `docs/`; corrected the historical Operations portal status and rollback notes.
- No database schema or migration files were changed; no user grants were created; no bridge was activated.

## C. Migration results

| Migration | Baseline verified? | Staging applied? | Schema verified? | Rollback |
| --- | --- | --- | --- | --- |
| 0013 `fearless_wasp` | No; local source journal only, current remote ledger unavailable | No | Offline SQL/dependency/constraint review only | Restore old role checks only after proving no stored Chief Security Operator value remains |
| 0014 `smiling_nextwave` | No | No | Offline additive schema review only | Prefer bridge shutdown and application rollback while preserving additive schema/identity links; no safe destructive down migration |

The Supabase CLI is the configured migration authority. Supabase migration files for 0013/0014 are absent. Local remote-ledger evidence is historical and stale relative to later checked-in migration files; do not infer production state.

## D. Identity bridge results

Code review confirms server-side central session lookup, active grant lookup, passwordless projection, hashed opaque token, HTTP-only scoped cookie, source-session-bound row, source-expiry cap, rotation by source session, request-time role/grant checks, origin protection, and legacy account-link protections. Focused policy/audit tests pass.

The required valid-exchange, invalid-session, grant-revocation, session-rotation, expiry, collision, and legacy-account scenarios were not tested against PostgreSQL. There are no claims of database-backed success.

## E. Authorization results

The source route-to-permission matrix is documented in `IDENTITY_BRIDGE_SECURITY_TESTS.md`. CSO does not receive the `super_admin` route capability and cannot use Operations role administration. Central `/admin/it/access` grant/revoke remains restricted to a current central IT `super_admin`. The Operations payments API is a Kitz-only GET inspection endpoint; no payment mutation endpoint was found. MarketHub payment/database access remains isolated.

The unsupported-write fallback was corrected to deny. Some declared permissions (firewall, IP management, worker management, payment reconciliation) have no corresponding Operations route implementation and must not be presented as operational engines.

## F. Security findings

- **Critical:** None demonstrated in the offline source review. This is not a comprehensive penetration-test conclusion.
- **High:** No confirmed exploitable vulnerability from the available evidence. Staging and remote schema evidence are significant unresolved production blockers, not proof of a code vulnerability.
- **Medium, fixed:** Existing bridge requests could remain authorized when the central account had a non-active status other than `disabled`/`suspended`, or email verification was removed. Per-request policy now requires active + verified.
- **Medium, fixed:** Operations route rules without a write permission inherited their read permission for non-GET methods. They now fail closed.
- **Medium, fixed:** Bridged Operations mutations previously attributed events only to the Operations projection. They now retain the central administrator and source-session reference.
- **Low/operational:** Local `.env` emits a Vite warning that only development `NODE_ENV` is supported; builds still completed. MarketHub build reports a chunk above 500 kB. Neither was introduced or changed here.

## G. Test results

- Kitz typecheck: passed. Kitz full suite: 157 passed, 1 skipped, 0 failed (158 tests total). The skipped test requires a shared Redis instance and two app instances.
- MarketHub typecheck: passed. MarketHub full suite: 93 passed, 1 skipped, 0 failed. The skipped test requires shared Redis.
- Focused bridge/auth suite after final policy edit: 73 passed, 0 skipped, 0 failed.
- Production frontend builds: Kitz passed; MarketHub passed.
- Full dependency audit (`npm audit --audit-level=high`): 0 vulnerabilities reported for both packages.
- `git diff --check`: passed.
- Dedicated secret scanning: not run; `gitleaks`, `semgrep`, and `trivy` executables are not installed.
- PostgreSQL migration test, schema drift validation, actual identity integration tests, Redis multi-instance behavior, and production checks: not run, infrastructure unavailable.

## H. Deployment readiness

| Environment | Status | Evidence |
| --- | --- | --- |
| Local development | Code checks passed; database-backed behavior unverified | Focused/full tests, typechecks, builds, dependency audits |
| Staging | Not prepared or verified | No authorized isolated PostgreSQL/Redis configuration or restored backup |
| Production | Not verified; no deployment or migration performed | Current remote ledger, backup, owner approval, and post-deployment checks unavailable |

## I. Outstanding blockers

1. Authorized isolated PostgreSQL staging project, separate credentials, readable verified TLS CA, supported server version, schema role/permissions, and verified restore. The generic local `DATABASE_URL` target is unverified and was not read or used.
2. Current production and staging Supabase migration ledgers and catalog snapshots; existing historical report is not current.
3. Reviewed Supabase migration files/checksums for 0013/0014 in the reconciled deployment order; current Supabase stream does not include them.
4. Database-backed integration tests for all required bridge, revocation, collision, legacy and audit scenarios.
5. Shared Redis infrastructure for multi-instance rate-limit verification.
6. Bridge-specific UI showing real migration/activation/identity/session/verification/recent-event state. Existing UI has an exchange action but no full bridge status view.
7. Written database-owner approval and production maintenance window; production migration must not run without it.

## J. Next actions

1. Provision and verify isolated staging and restore; capture PostgreSQL version, owner/privileges, schema and Supabase ledger.
2. Reconcile all pending Supabase migrations and prepare reviewed 0013/0014 files only after ordering is established.
3. Apply to staging, verify schema and legacy row preservation, then execute database-backed integration tests and Drizzle/schema comparison.
4. Configure shared Redis and pass the two-instance test.
5. Implement and verify the live bridge status UI/API without inferring readiness from frontend presence.
6. Obtain explicit owner authorization, execute the documented production rollout, then record post-deployment evidence. Production remains unverified until then.