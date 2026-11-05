# KitCulture Production Readiness Report

**Assessment date:** 2026-11-05  
**Disposition:** **NOT PRODUCTION READY**

## Scope and evidence

Reviewed authentication/session code, customer ownership routes, admin and Operations APIs, permission maps, order/payment callbacks, uploads, environment and database configuration, migrations, seeds, frontend cart/portal flows, deployment guidance, logging, monitoring, and current tests. Ran targeted PostgreSQL catalog/count queries over verified TLS, local tests/builds/lint, npm advisory audits, and a remote Supabase migration dry-run. No production rows were read individually, created, modified, or deleted. No migration was applied. No live payment, email, or Cloudinary request was initiated.

## Verified database state

| Check | Result |
| --- | --- |
| TLS-verified PostgreSQL `SELECT 1` | Passed |
| Public base tables | 62 |
| RLS-enabled public tables | 62 of 62 |
| Runtime role `BYPASSRLS` | `true` |
| Supabase migration ledger | 11 applied; latest `20261103000010` |
| Drizzle tracker | 1 initial-baseline marker |
| Aggregate row counts | 1 user, 7 admins, 4 orders, 4 payments, 1 product, 4 variants, 4 categories, 1 delivery zone, 1 support request, 4 notifications, 8 inventory movements |
| Remote Supabase dry-run | Only `20261105000000_enable_public_rls.sql` pending; not applied |

Counts do not prove source provenance, import parity, or whether rows are production/test/operator-created. No personal records were inspected. The 46-table figure in historical docs describes the original baseline; later migrations bring the live catalog to 62.

## 1. Security vulnerabilities discovered

| Severity | Affected file(s) | Problem | Correction performed | Verification |
| --- | --- | --- | --- | --- |
| High | `server/src/modules/operations/routes.ts` | `/permissions` and security actions promoted the first Operations user to `super_admin` over HTTP when none existed. | Removed both HTTP self-promotion paths; bootstrap is a one-time CLI action requiring explicit approval and an exact email match. | Operations permission matrix tests pass. |
| High | `server/src/modules/operations/routes.ts`, `server/src/modules/admin/it-access.ts` | Most Operations endpoints authenticated any Operations user but did not check the role permission map. | Added default-deny path/method permission enforcement for protected Operations routes. | Unit matrix covers viewer, security, database, infrastructure, super-admin, and unmapped routes. |
| High | `server/src/modules/admin/routes.ts`, `server/src/modules/admin/permission-routes.ts` | Dashboard response projection used default role permissions after the API gate, ignoring individual permission revocations. | Pass the verified effective permission set into projection; require the role's dashboard permission for portal summaries. | Tests verify revoked finance permissions remove financial fields. |
| Medium | `server/src/modules/admin/ecosystem.ts` | Batch archive was nested in the single-account DELETE handler and not registered at router initialization. | Moved the route to top-level registration; kept transactional audit, self-archive, and last-Super-Admin protections. | Router registration assertion and unauthenticated API regression pass. |
| Medium | `server/src/modules/admin/ecosystem.ts` | Super Admin ecosystem writes lacked an explicit Origin check. | Added same-origin enforcement before ecosystem routes. | Hostile-origin integration test returns `403 ORIGIN_REJECTED`. |
| Medium | `server/src/modules/admin/permission-routes.ts`, `server/src/modules/admin/administration.ts` | PO receiving/approval, reconciliation, email send, inventory dashboard and specific inventory rules were over-broad or shadowed. | Added narrower permissions and specific-before-general matching. | Permission suite passes with route-specific assertions. |
| Medium | `server/src/modules/orders/routes.ts` | Optional checkout GPS values were persisted as `"undefined"`; support request insert returned the notification ID column. | Persist absent coordinates as `NULL`, label the pin `not shared`, and return `support_requests.id`. | Auth/order tests pass for missing and provided pins. |
| Medium | `server/src/scripts/provision-admin.ts` | CLI-created admin lacked role and active status and could not use the current login flow. | Creates an active, audited Sales Admin with allocated role number. | Typecheck/build pass; no live account was created. |
| Low | `server/src/modules/operations/routes.ts`, `server/src/modules/security/scanner-engine.ts` | Scanner catalog claimed npm audit was healthy before a scan ran. | Reports `not_run` or `not_configured`; unsupported scanners remain not configured. | Scanner test executes npm audit and verifies availability states. |

## 2. Vulnerabilities corrected

The corrected items are listed above. The administrator business router already default-denies routes without a permission policy; route-specific gaps and custom-permission projection leaks were corrected. Existing customer ownership predicates, password hashing, opaque session tokens, CSRF/Origin checks, payment-provider verification, audit records, and transaction logic were preserved. No authentication/API response contract was intentionally changed.

## 3. Security risks still outstanding

- **High:** PostgreSQL runtime role has `BYPASSRLS=true`; enabled RLS therefore does not contain a compromise of the application connection. Replacing the role requires database-owner approval and staging verification; no database grants/roles were changed.
- **High:** Full live schema/migration/data parity is not reconciled. The 11-entry Supabase history and one-row Drizzle marker are separate by design but need owner-reviewed release evidence.
- **Medium:** Rate limits are process-local; they may not coordinate across deployed instances. `trust proxy = 3` must match the real proxy chain.
- **Medium:** Email verification is optional by default. Registration returns a distinct conflict response for an existing email.
- **Low:** Uploads validate size and magic bytes but do not decode/re-encode or malware-scan images.
- Provider-side origin/DNS/WAF/TLS, secret rotation, backup access/restore, and production session roles were not independently inspected.

## 4. Incomplete functionality

| Workflow | Status | Remaining work |
| --- | --- | --- |
| Registration, email verification, password reset | Implemented, provider-dependent | Email is disabled by default; live sender/domain/delivery are unverified. |
| Customer cart | Partial | Browser `localStorage` only; no server persistence/sync/merge API. |
| Orders and cancellation | Implemented | Server-calculated totals, stock reservation, idempotency, and pending-order cancellation exist; no expiry worker. |
| M-Pesa | Implemented, live path unverified | Provider query and idempotent settlement exist; no approved live transaction/reconciliation. |
| Refunds/reconciliation | Partial/manual | Records and manual provider references exist; no provider refund execution or settlement-feed import. |
| Returns | Partial | Admin-side return records exist; customer-facing request workflow is absent. |
| Suppliers/PO/receiving | Implemented in API | UI and PostgreSQL integration/concurrency coverage remain incomplete. |
| Delivery/courier | Partial | Tracking and admin-shared pins exist; assignment, dispatch scheduling, and courier management are absent. |
| Notifications/marketing | Partial | In-app notifications, coupons and email-campaign APIs exist; role UI and live email delivery are incomplete/unverified. |
| Customer administration | Partial | Customer listing/support exist; broader account administration, retention, and export controls are incomplete. |
| Cloudinary | Implemented, unverified live | Signed upload/delete code exists; production credentials and provider operation were not verified. |

## 5. Demonstration data identified

No fake customer/order/payment seed script was found in the inspected scripts. The only seed script found, `server/scripts/seed-football-catalogue.mjs`, inserts reference leagues, teams, collections, and jersey categories idempotently; preserve this legitimate reference data. Test fixtures are in test files. Current database rows were not classified as demo or production data and must not be deleted automatically.

Safe cleanup plan: obtain owner approval; take and restore-test a consistent backup; reconcile every table against the source; create an exact candidate-ID list with reasons; have a second reviewer validate a read-only count; then execute only an approved transaction with before/after counts, audit evidence, and tested recovery. Never clean by broad predicate, `TRUNCATE`, or automatic script.

## 6. Production-unnecessary code removed

No broad cleanup was performed. The obsolete `OPERATIONS_SIGNUP_SECRET` setting/documentation was removed because public Operations registration is disabled. Debug logging, security audit records, scanner evidence, and monitoring instrumentation were preserved. No dependency was removed without a completed dependency-usage review.

## 7. Database improvements and limitations

No schema or production migration was applied. Current protections include PostgreSQL TLS verification, Drizzle parameterization, foreign keys/indexes, transaction-based order/stock/payment paths, bounded public catalogue pagination, and batched catalogue enrichment. The runtime RLS bypass remains an owner decision. Query plans, all foreign-key/index parity, exact grants, `FORCE ROW LEVEL SECURITY`, sequence alignment, and source row parity were not verified. The added RLS SQL is pending and must not be deployed without reviewing Supabase Data API, Realtime, and runtime grants.

## 8. Performance and UX/UI

Existing lazy routes, responsive images, loading/empty/error states, and mobile layouts were preserved; no redesign was warranted. Production build passes. No representative production load profile or database query-plan study was run. Server-side cart and several workflows remain absent, so no claim is made that those experiences are complete.

## 9. API improvements

Operations endpoints now fail closed on missing permission mappings; admin route policies are narrower for the reviewed actions. Super Admin mutations apply Origin checks. Customer-owned addresses, notifications, support, and orders remain session-scoped. API contract changes were avoided. Full route-by-route authenticated PostgreSQL tests are still needed.

## 10. Testing results

- `npm run typecheck`: passed after remediation.
- `npm run build:deploy`: passed; Vite warned that local `.env` sets `NODE_ENV=production`. The file was not changed.
- `npm audit` and `npm audit --omit=dev`: 0 known advisories each.
- `npm run lint`: completed with 14 existing React hook/style warnings; none were reported in remediation files.
- `npm test`: 131 passed, 0 failed.
- PostgreSQL database integration, ownership/stock contention, payment reconciliation, backup restore, and full authenticated end-to-end tests: not run.

## 11. External integrations requiring configuration/verification

- Email: configure verified sender/domain and SMTP or Resend credentials; run verification and reset delivery tests.
- Daraja: confirm merchant approval, production credentials, callback URL/token, then run an approved low-value end-to-end reconciliation.
- Cloudinary: configure server-side credentials and verify uploads/deletes in staging.
- Supabase/hosting: confirm TLS CA, runtime role/grants, provider logs, origin/WAF/DNS, backups, and restore procedure.
- No integration is described as operational based solely on code presence.

## 12. Deployment requirements

Use the production build commands and secret manager; keep database credentials server-side. Run `npm run db:supabase:dry-run -- --remote`, review all proposed migrations, restore a backup in isolated staging, execute workflow tests, and obtain owner approval before any push or traffic change. The local Supabase config disables automatic exposure of newly created public tables, but that config was not pushed to the hosted project. Never route live traffic to an unreconciled dataset.

## 13. Remaining production blockers

1. Establish provenance and source parity for current data; backup and restore-test before any cleanup/cutover.
2. Reconcile Supabase migration ledger, live catalog, constraints, grants, RLS and Drizzle baseline marker with the database owner.
3. Decide/test a least-privilege runtime role; current `BYPASSRLS` is a material risk.
4. Verify email, Cloudinary, production Daraja, production origin/edge and backup/restore settings in authorized staging/provider accounts.
5. Add/run PostgreSQL integration tests for ownership, permissions, stock contention, expiry, callbacks, refunds and reconciliation.
6. Complete end-to-end checkout, administrator and payment testing plus rollback rehearsal.

Passing tests and builds do not make KitCulture production-ready. **Current disposition remains NOT PRODUCTION READY.**
