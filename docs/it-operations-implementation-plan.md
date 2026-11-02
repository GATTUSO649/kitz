# KitCulture IT Operations Portal Plan

**Phase:** A — existing-system audit and implementation plan  
**Date:** 2026-11-02  
**Status:** Existing portal and role work remain as recorded below. A monitoring-engine foundation is implemented locally; its additive migrations are generated but not applied.

## Implementation Update — 2026-11-02

The first Phase B vertical slice is now implemented locally: admin-session-protected `/admin/it` overview/access APIs, explicit nullable IT role grants, super-admin-only grant/revoke controls, and a one-time bootstrap CLI. The Operations role migration is generated as `server/src/database/postgres-drizzle-migrations/0001_mean_karnak.sql` and is not applied. No administrator has been granted IT access; no one-time bootstrap was run. Existing `/operations` identity, sessions, users, and portal behavior remain unchanged. Provider telemetry, security-event ingestion, alert rules, vulnerability records, support ticketing, backup monitoring, and historical metrics remain future phases and are not represented as implemented.

## Monitoring Engine Implementation Update — 2026-11-02

- Added validated monitoring event contracts and asynchronous, bounded PostgreSQL persistence for route-template HTTP telemetry. Request IDs are generated server-side; only UUID correlation IDs are accepted. Request bodies, cookies, tokens, IP addresses, and raw URLs are not recorded.
- Added persistent security status signals for 401/403/429 and generic application failure events for 5xx responses. These are signals, not individual attack determinations.
- Added protected `/api/v1/operations/telemetry`, `/events`, `/metrics`, `/detections`, `/alerts`, `/workers`, and `/health` endpoints. The existing overview now prefers persistent aggregates and labels the prior bounded sample `process_local_fallback` when storage is unavailable.
- Persistent request summaries include RPS, response counts/distribution, route/method breakdowns, average/min/max and raw-sample P50/P95/P99 latency, and 12 time buckets. Historical source events are retained for 30 days.
- Added configurable rule, deduplication history, alert lifecycle, and worker state tables. A PostgreSQL advisory lock coordinates detection across instances; default rules evaluate only recorded aggregate HTTP route/status signals, and never auto-block users.
- Added queue retry/backoff, queue bounds, collection freshness counters, worker heartbeats, and bounded statement timeout. Monitoring persistence errors do not fail customer responses.
- Generated PostgreSQL migrations `0002_lumpy_nemesis.sql` through `0007_remarkable_chat.sql`. They have not been applied to any database and contain only additive monitoring tables/columns/constraints/indexes.

Rollback: the migration set is not auto-applied at startup. Before deployment, rehearse against a restored staging database and verify backups. If application code must be rolled back after migration, first stop the worker and deploy the prior code; leave additive tables in place. Drop tables only in reverse dependency order (`monitoring_alerts`, `monitoring_detection_history`, `monitoring_detection_rules`, `monitoring_worker_state`, then `monitoring_events`) after confirming telemetry retention/export needs and obtaining database-owner approval. Reversing `0003`/`0005`/`0006` columns or constraints is not required for code rollback and would discard operational data.

Not yet implemented: durable job/dead-letter tables and worker retry audit, 1/5/15-minute/hour/day aggregate tables, business/auth/upload/provider event hooks beyond HTTP status signals, alert notification delivery, rule-management mutations, role-granular authorization beyond the existing Operations session gate, integration credentials/probes, scheduled reports, and account-distinct metrics. Provider and infrastructure health remain unknown without authorized provider data. Production rollout requires review and application of the generated migrations through the existing staging/backup process.

Verification for this update: `npm test` passed (102 tests); `npm run typecheck` passed; `npm run build:deploy` passed; focused Oxlint on all changed engine/UI files passed. Repository-wide `npm run lint` passed with 12 existing React hook warnings in unrelated frontend files. `drizzle-kit check` reported a consistent migration history. Migrations were generated only; migration application, staging rehearsal, and live database-backed worker/event verification were not performed.

## Objective and Constraints

Extend the existing React/Vite, Express, Drizzle/PostgreSQL application and `/operations` portal. Preserve customer/admin behavior, cookies, bcrypt, payment verification, Cloudinary, email, middleware, and APIs. Do not invent telemetry or claim provider health without evidence. Use additive PostgreSQL migrations only; do not execute production migrations without an approved release, verified backup, and staging rehearsal.

## Existing Operations Capabilities

| Area | Current implementation | Limitations |
| --- | --- | --- |
| Operations UI | `/operations`; Overview, Incidents, Audit tabs in `src/pages/OperationsPages.tsx` and `src/operations-theme.css`. | No dedicated security, vulnerability, API/database, payments, backups, tickets, or reports pages. |
| Identity/session | `operations_users`, `operations_sessions`, `kc_ops_session`, bcrypt, hashed opaque token, idle/absolute expiry, disable/session revocation. | Separate login and session store from existing administrator auth, contrary to the new requirement not to introduce independent IT identity. |
| Access control | Protected Operations router; Operations identity distinct from store admins. | No IT role/permission matrix. Existing Ops users can create/update incidents and view Ops audit. Store admins and Ops users do not share access. |
| Health | Process uptime, Node version, memory, `SELECT 1` latency for store/admin pools. | No CPU/disk/network metrics; health probe does not show schema completeness or external provider readiness. |
| API monitoring | Bounded in-memory sample, request/error counts, latency summaries, route templates. | Per-process, reset on restart, not shared between Render instances or historical. No request bodies/IPs are collected. |
| Incidents | Manual incidents, severity/status/assignee, notes, root cause/resolution, event timeline. | No rule-based detection, alert deduplication, notification delivery, or automated incident linking. |
| Audit | Operations-specific audit events; admin audit exists separately. | No unified viewer or verified tamper-resistant/export controls; no security event ingestion pipeline. |
| External services | Render, backup, Cloudflare, Daraja, email are explicitly shown as `unknown`. | No authorized provider telemetry configured; no backup evidence or live payment probe. |
| Support | Existing customer support routes and admin tools. | No separate internal IT ticket workflow. |
| Vulnerabilities | Security review and package audit can be run manually. | No persisted finding lifecycle or scan ingestion. |

## Current Architecture and Security Boundary

- Frontend: React 19, TypeScript, Vite, existing design system and route wiring.
- Backend: Express 5, TypeScript, centralized middleware/error handling, route modules.
- Data: Drizzle PostgreSQL schemas and one shared `pg.Pool` for app/admin data; PostgreSQL CA verified in production. The runtime DB role has `BYPASSRLS`; backend authorization is therefore the actual row-access boundary.
- Store/admin auth: bcrypt and database-backed opaque sessions with HttpOnly, SameSite=Strict cookies; Secure in production. Admin routes require authenticated admin middleware.
- Existing Operations auth: independent Ops user/session tables and cookie, rather than shared admin auth. A `operations_operators` grant table exists but is currently unused.
- Telemetry and external providers: server-side only; no provider credentials or telemetry endpoints should be added to client code.

## Required Decision Before Implementation

The requested portal says not to add a second independent authentication system and not to grant existing admins IT privileges automatically. The application already has a separate Operations identity. Choose the supported transition before adding new IT permissions:

1. **Recommended:** Reuse existing administrator accounts/sessions with an explicit, audited Operations grant and explicit IT role assignments. Migrate existing Operations users only by individually approved account mapping; do not auto-grant them or all administrators. Keep a staged compatibility window and test rollback before retiring the old Ops login.
2. Keep the existing independent Operations identity and extend its authorization model. This is lower migration risk but does not satisfy the requirement to avoid a second independent authentication system.

This changes account access and may affect existing operators. No identity migration, grants, or privilege backfill should be made without explicit owner approval and a tested staging plan.

## Phased Implementation

### Phase B — Identity, roles, and portal shell

- Resolve the identity decision above.
- Define an approved permission matrix for Security Analyst, IT Support Technician, Database Administrator, Infrastructure Administrator, Viewer, and Super Admin.
- Enforce permissions server-side on each route; do not infer permissions from UI visibility.
- Extend existing `/operations` navigation without changing customer/admin pages.
- Keep existing sessions, cookies, Origin protection, rate limits, and audit behavior; explicit grants only.

### Phase C — Security events and audit foundation

- Add an additive event model with event type, severity, component, safe actor reference, request ID, status/assignment, and resolution notes.
- Instrument existing auth, authorization, rate-limit, upload, admin, payment, and DB failure paths using allowlisted metadata; never store raw bodies, passwords, cookies, tokens, API keys, or full payment payloads.
- Keep existing admin/Operations audit tables; link rather than duplicate audit events where practical.
- Add cursor pagination, retention policy, and least-privilege read access.

### Phase D — Security operations and vulnerability management

- Add a rule registry with explicit threshold, window, cooldown, enabled state, and deduplication key.
- Start with deterministic events already emitted by the app; do not auto-block customers.
- Add vulnerability records/status history for npm audit, tests, configuration checks, and manual findings; label source and verification distinctly.
- Add regression tests for detection, deduplication, permissions, and redaction.

### Phase E — Operations dashboards

- Extend current Overview with request/DB metrics while labeling process-local and unavailable data.
- Add authentication/API/database/payment pages backed by verified application telemetry only.
- Keep provider services `unknown` until authorized read-only provider integration is configured and tested.
- Do not add unrestricted SQL, shell, restart, or production configuration controls.

### Phase F — Incidents, tickets, alerts, and reports

- Extend current incident lifecycle with linked events/vulnerability/tickets and append-only timeline.
- Add internal IT tickets with requester/assignee/status/private notes and scoped permissions.
- Add email/in-app alert delivery only after recipients, thresholds, retries, dedupe, and secret configuration are approved.
- Add exports with bounded date ranges, pagination, redaction, and role checks.

### Phase G — Provider and infrastructure integrations

- Add optional, server-side, read-only integrations for Render, Cloudinary, Resend, Daraja, and backup evidence only when credentials/scopes are explicitly authorized.
- Keep unsupported CPU/disk/network metrics unavailable. Do not treat successful HTTP submission as delivery or payment confirmation.
- Add distributed scheduling/locking only if a real multi-instance monitoring job is introduced; otherwise avoid new worker infrastructure.

### Phase H — Controlled database rollout and verification

- Generate additive Drizzle/PostgreSQL migrations, review SQL and indexes, restore-test a backup in staging, and test with least-privilege DB credentials.
- Do not run migrations at startup or execute them against production during development.
- Test auth/role matrix, unauthorized access, event redaction, dedupe, incidents, ticket ownership, alert failures, provider timeouts, transactions, and existing checkout/admin/customer flows.
- Roll out behind explicit feature/configuration controls with rollback and verified production health checks.

## Verification Gates

- Baseline: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:deploy`, `npm audit`.
- Authorization: every new route has positive and negative role tests; no role is granted by default.
- Privacy: test logs/events contain no secrets, tokens, cookies, full request bodies, or unnecessary customer data.
- Reliability: monitoring and notification failures do not fail customer requests; alerts deduplicate across instances if jobs are distributed.
- Data: additive migrations tested against a restored staging backup; no production migration until approval.
- Operations: provider telemetry and backup claims match actual authorized provider evidence.

## External Inputs and Blockers

- Owner approval of identity transition and role/permission matrix.
- Current operations account inventory and individually approved mapping, if migrating identities.
- Staging database snapshot/restore and approved migration window before schema rollout.
- Least-privilege PostgreSQL role decision; current runtime role bypasses RLS.
- Authorized read-only provider credentials/scopes for Render, Cloudinary, email, Safaricom, and backup status; none are assumed or requested here.
- Alert recipients, on-call ownership, retention periods, and privacy policy for operational/security event data.
- Current operations portal has no ticketing, persisted security events, rule engine, vulnerability store, provider telemetry, backup monitor, or notification dispatcher.

## Phase A Result

The existing Operations console is a sound starting point for process/DB probes, request telemetry, manual incidents, and audit history. The complete portal is not implemented. Start with the identity/permission approval and additive event/audit foundation; implement provider-specific monitoring only after authorized telemetry is available. No unsupported metric should be displayed as healthy.