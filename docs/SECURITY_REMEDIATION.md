# Security Remediation Tracker

Statuses are evidence-based: Not started, Under investigation, Implemented, Testing, Verified, Blocked, or Accepted risk. A passing code test does not verify production credentials, database grants, Render topology, or provider controls.

| ID | Priority | Application | Remediation | Status | Evidence / remaining gate |
|---|---|---|---|---|---|
| KC-DB-001 | P0 | Kitz | Require a separate Admin database project and dedicated administrator pool | Implemented in code; not live-verified | Verify Admin/Kitz project identities, dedicated runtime grants, and production cutover with approved credentials. |
| MH-PAY-001 | P1 | MarketHub | Add endpoint-specific limits to STK initiation | Implemented | Regression verifies the ninth request is throttled. Store remains process-local; shared enforcement is still required. |
| MH-PAY-002 | P0 | MarketHub | Make active-payment reservation/idempotency atomic under concurrency | Implemented | Listing-row lock + in-transaction active-state check/reservation; Daraja executes after commit. True concurrent PostgreSQL test is blocked by absent isolated DB. |
| KC-PAY-001 | P0 | Kitz | Verify payment initiation is serialized and uncertain states cannot retry | Implemented | Existing guest and customer routes lock the order row and block unresolved states. No DB concurrency test run. |
| MH-HEALTH-001 | P1 | MarketHub | Restrict detailed worker/provider health diagnostics | Implemented | Public health is generic; detail route is protected by central `admins:manage` permission. Authenticated DB-backed route test remains outstanding. |
| DB-PREFLIGHT-001 | P1 | MarketHub | Verify runtime sequence privileges and ownership | Implemented | Read-only preflight reports sequences and blocks missing `USAGE` or runtime ownership; unit test passes. Live preflight not run. |
| DIST-LIMIT-001 | P1 | Kitz + MarketHub | Replace process-local limits with shared fail-closed storage | Implemented | All current policies use Redis when configured with app/policy prefixes, hashed account/IP keys, production startup gating, bounded connect/command timeouts, and 503 on store errors. Production Redis is not configured; multi-instance integration test is skipped pending `REDIS_TEST_URL`. |
| AUTH-001 | P1 | Kitz + MarketHub | Complete authentication/MFA and account-level abuse reassessment | Not started | No complete pass or production MFA verification performed. |
| DB-001 | P0 | Kitz + MarketHub | Verify production roles, grants, RLS, schema isolation, and migration state | Blocked | MarketHub preflight covers roles/table grants/public isolation/RLS and now sequences, but was not run. Kitz has no equivalent automated grant audit. Approved read-only/runtime role credentials are unavailable. |
| AUTH-MFA-001 | P1 | Kitz + MarketHub | Add central administrator TOTP, recovery, step-up, and revocation | Blocked | Architecture/design recorded in `SECURITY_MFA_DESIGN.md`; no MFA schema or protocol exists. Requires approved additive migration, managed KMS/HSM, central Kitz challenge flow, and MarketHub compatibility tests. |
| SUPPLY-001 | P1 | Kitz + MarketHub | Verify dependency, secret-scanning, SAST, and CI security gates | Not started | Workflows and lockfiles were not comprehensively reviewed in this pass. |
| SOC-001 | P2 | Kitz + MarketHub | Implement real centralized security events, findings, incidents, and alerting | Not started | No dashboard or event statistics were added; no fabricated monitoring data is used. |
| TEST-001 | P1 | Kitz + MarketHub | Expand security regression and isolated integration testing | Under investigation | Existing Kitz suite: 144 passing; existing MarketHub suite: 86 passing. These suites do not cover the full requested threat model. |

## Current change verification

- Kitz: `npm run test` passed (149 passed, 1 Redis integration test skipped); `npm run typecheck` passed; `npm run build:deploy` passed. Tests required a process-only CA override because the `.env` CA file target is missing; `.env` was not changed.
- MarketHub: `npm --prefix platform test` passed (93 passed, 1 Redis integration test skipped); `npm --prefix platform run typecheck` passed; `npm --prefix platform run build:deploy` passed.
- New sequence privilege helper test passed as part of the MarketHub suite.
- Redis packages installed successfully after `npm cache verify` reclaimed stale npm cache data. No production or isolated PostgreSQL database, Daraja, Render, Redis service, or GitHub Actions environment was accessed.

## Deployment prerequisites for the implemented changes

1. Configure `ADMIN_DATABASE_URL` to the separate Admin Supabase project with a dedicated least-privilege runtime role. The code fails closed in production if it is missing or resolves to the same Supabase project as `DATABASE_URL`.
2. Verify administrator and store database roles and grants in a non-production environment before production rollout; the application test only verifies separate pool construction.
3. Configure `REDIS_URL` in both production app secret stores and verify connectivity, fail-closed behavior, and shared counters across multiple instances before rollout/scaling.
4. Run concurrent MarketHub payment initiation against an isolated production-equivalent PostgreSQL database and test duplicate callback/reconciliation paths before claiming race verification.
5. Add and approve the central administrator MFA migration/protocol before enabling a required-MFA policy.
6. Run the Kitz and MarketHub database privilege audits with approved read-only credentials and separately confirm database-owner grants. Do not execute production migrations as part of this verification.
7. Do not treat application-level controls as a replacement for upstream DDoS/WAF controls, provider controls, or production monitoring.
