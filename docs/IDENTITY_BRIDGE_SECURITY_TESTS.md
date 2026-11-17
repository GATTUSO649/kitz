# Identity Bridge Security Tests

**Evidence date: 2026-11-16.** Tests described as automated below ran locally without database, staging, or Redis credentials. They do not prove database-backed bridge activation.

## Automated results

- Kitz full test script: 158 tests, 157 passed, 1 skipped, 0 failed. The skipped case is the two-instance shared-Redis counter/expiry integration test; Redis was not configured.
- MarketHub full test script: 94 tests, 93 passed, 1 skipped, 0 failed. Its skipped case is the same shared-Redis integration requirement.
- Focused central auth/Operations policy suite after the changes: 73 passed, 0 failed, 0 skipped.
- Kitz and MarketHub typechecks passed. Production builds passed. Full dependency audits reported zero vulnerabilities in each package.
- The exchange now has a dedicated per-central-admin 10-per-15-minute shared Redis limit; this code path was typechecked, but the limiter was not exercised against Redis.
- No PostgreSQL integration test ran. No migration was applied. No live Redis integration test ran.

## Scenario evidence

| Scenario | Offline evidence | Database-backed staging result |
| --- | --- | --- |
| Valid central session, active verified administrator, active permitted grant, successful exchange | Exchange and policy inspected in code | Not run; staging unavailable |
| Expired, revoked, or invalid source session | Source-session lookup/expiry and cascade inspected | Not run |
| Suspended, pending, rejected, disabled, or unverified administrator | Per-request active + verified policy now enforced; policy unit tests cover inactive states | Not run |
| Missing, revoked, or unauthorized role grant | Current grant join and role allowlist inspected | Not run |
| Repeated exchange rotates previous session | Transaction deletes sessions for the exact source-session ID before insert | Not run |
| Idle renewal cannot exceed source expiry | Renewal caps expiry to source-session expiry | Not run |
| Browser-supplied administrator or role; client lifetime extension | Identity/role are selected server-side; cookie lifetime comes from server expiry | Not run |
| Duplicate email, legacy account collision, conflicting projection | Email collision branch fails closed; schema uniqueness inspected | Not run |
| Legacy password reset/role edit/detach protections | Login rejects linked rows; role editor rejects central-linked rows | Not run |
| Unlinked legacy Operations login | Existing password path remains restricted to unlinked accounts | Not run |
| Central admin and source-session audit attribution | Shared audit helper and exchange events have focused unit coverage | Not run |
| Exchange-specific rate limiting and no-store behavior | Dedicated limiter wiring typechecks; unauthenticated exchange HTTP test verifies `Cache-Control: no-store` | Redis-backed rate count not run |
| Shared distributed Redis counters across instances | Existing test is explicitly skipped without Redis | Not run |

## Route-to-permission matrix (source policy)

| Method and route | Required permission | Notes |
| --- | --- | --- |
| `GET /me`, `/telemetry`, `/health`, `/overview` | `overview.read` | Authenticated Operations session required |
| `GET /operators`, `/permissions` | `super_admin` | CSO cannot administer Operations roles |
| `PATCH /permissions/users/:id/role` | `super_admin` | Handler also rejects linked central identities |
| `GET /detections`, `/events`, `/metrics` | `security.read` | Read-only routes |
| `GET /workers`, `/runtime-performance`, `/provider-performance` | `infrastructure.read` | Read-only routes |
| `GET /database-performance` and `/database-performance/events` | `database.read` | Read-only routes |
| `GET /payments` | `payments.operations.read` | Kitz-only; no payment write route exists; MarketHub selection returns conflict |
| `POST /admin/it/operations-session` | Authenticated central admin plus active explicit `chief_security_operator`/`super_admin` IT grant | Central permission middleware, CSRF origin check, 10-per-15-minute per-admin shared rate limit, and no-store response |
| `GET /alerts` / `PATCH /alerts/:id` | `incidents.read` / `incidents.write` | Update is audited |
| `GET /incidents`, `/incidents/:id/events` | `incidents.read` | Read-only routes |
| `POST /incidents`, `PATCH /incidents/:id`, `POST /incidents/:id/events` | `incidents.write` | Incident/audit events retain bridged actor IDs |
| `GET /audit` | `audit.read` | Read-only audit listing |
| `GET /security/*` | `security.read` | Includes scans, scanners, findings, reports, and schedule reads |
| `POST /security/scans`, `/security/scans/:id/cancel` | `security.scan` | Audited |
| `PATCH /security/findings/:id/status` | `security.findings.write` | Audited |
| `PUT /security/schedule` | `dependencies.manage` | Audited |
| Unmatched routes and unsupported mutation verbs | Deny (`null`) | Route policy now fails closed instead of inheriting read access |

`chief_security_operator` has no `super_admin` permission and cannot use `/operators`, `/permissions`, or the role-update API. Some permissions in the shared role list (for example firewall management and payment reconciliation management) have no corresponding implementation in these Operations routes; permissions do not prove those engines exist. Payment inspection is read-only.

## Remaining required staging tests

Run against a fresh isolated database restored from the verified staging backup, with the exact current baseline recorded. Tests must cover each scenario above using actual sessions, grants, projection rows, and audit rows; verify existing legacy rows and login; verify required columns, constraints, FKs, and indexes after both migrations; and confirm raw tokens never appear in stored audits/logs. Run the existing Redis test against a shared Redis service with two independent app instances.

These staging cases are blockers, not passing tests. Do not label Phase 4 complete until they pass.