# Security Audit

## Assessment scope

This is a focused source-code reassessment of the Kitz and MarketHub backend paths changed or checked in the current remediation pass. It is not a complete audit of the repository, a penetration test, a production configuration review, or evidence that deployed migrations and database grants are correct. No production database, Render settings, external monitoring account, or live payment credentials were accessed.

## Findings

### KC-DB-001: Administrator operations shared the store database pool

- **Severity:** High, pending production privilege verification
- **Application:** Kitz
- **Affected file:** `server/src/config/database.ts`
- **Affected operations:** Queries made through `adminDb` / `adminPool`
- **Evidence:** The prior implementation fell back to the Kitz URL when `ADMIN_DATABASE_URL` was missing and could reuse the store pool.
- **Impact:** When administrator and store operations use the same PostgreSQL identity, compromise of the application connection can reach both data surfaces allowed to that identity.
- **Remediation:** Production requires a distinct Admin Supabase project URL, Admin resolution never falls back to Kitz, and the Admin pool is created independently. Live project identity, grants, and cutover remain unverified.
- **Status:** Implemented; database grants and deployed credential separation remain unverified.
- **Verification:** Kitz server tests and typecheck pass. The regression test asserts distinct pool objects when distinct URLs are configured. This does not verify PostgreSQL role privileges.

### MH-PAY-002: Concurrent MarketHub payment initiations could race

- **Severity:** High
- **Application:** MarketHub
- **Affected file:** `platform/server/src/modules/payments/routes.ts`
- **Affected operations:** Publication and contact-unlock STK initiation
- **Evidence:** Active-payment detection and insertion previously occurred outside a transaction that serialized requests for a listing.
- **Remediation:** A database transaction now locks the listing row, revalidates listing state, checks active payment states (`initiated`, `pending`, `processing`, `ambiguous`), then inserts a reservation. The Daraja request runs only after commit. Existing unresolved requests are reused/rejected, including old contact-unlock requests; no automatic retry is allowed for uncertain states.
- **Status:** Implemented; live concurrent PostgreSQL verification remains blocked.
- **Verification:** MarketHub test suite, typecheck, and production build pass. The test environment has no isolated PostgreSQL integration URL, so this is not yet a verified concurrent-transaction test.

### KC-PAY-001: Kitz payment initiation serialization

- **Severity:** Medium, pending database-backed test
- **Application:** Kitz
- **Affected file:** `server/src/modules/orders/routes.ts`
- **Affected operations:** Guest and authenticated STK initiation
- **Evidence:** Both routes lock the target order row with `FOR UPDATE`, check unresolved payment state, and create the payment row in the same transaction. Unknown outcomes become `requires_review` and are not retryable.
- **Status:** Existing protection confirmed; no code change in this pass.
- **Verification:** Existing Kitz suite passes. No live concurrent PostgreSQL test was run.

### MH-PAY-001: Payment initiation had no endpoint-specific request limit

- **Severity:** Medium to High, depending on production topology and abuse exposure
- **Application:** MarketHub
- **Affected file:** `platform/server/src/modules/payments/routes.ts`
- **Affected endpoints:** `POST /api/v1/marketplace/payments/publication`, `POST /api/v1/marketplace/payments/contact-unlock`
- **Evidence:** Both initiation endpoints relied on the general `/api/v1` limiter. They now additionally share an eight-request per ten-minute Express rate limit. Callback processing is not behind this limiter.
- **Impact:** A client able to issue many initiation requests can create payment prompts and consume provider/application resources.
- **Remediation:** Endpoint-specific process-local rate limiting added with a safe `429` response.
- **Status:** Implemented (single-process enforcement only).
- **Verification:** MarketHub test suite passes, including a regression asserting the ninth initiation attempt is rejected.
- **Residual risk:** The limiter uses the default in-memory store. It is not shared across Render instances and is not a substitute for provider-level or distributed abuse controls.

### Historical observation: Payment duplicate checks were not atomic

- **Severity:** High
- **Application:** MarketHub
- **Affected file:** `platform/server/src/modules/payments/routes.ts`
- **Affected operations:** Publication and contact-unlock STK initiation
- **Evidence:** The endpoints query for an active payment and later call `startPayment`, which inserts a payment in a separate operation. Concurrent requests can both pass the query before either insert completes.
- **Impact:** Concurrent requests may create multiple STK prompts for the same listing or phone/listing pair.
- **Remediation:** Add a database-enforced reservation/idempotency mechanism or transactional lock around active-payment detection and reservation, with migration and concurrency tests.
- **Status:** Superseded by MH-PAY-002 above.
- **Verification:** No database-backed concurrency test was run.

### MH-HEALTH-001: Worker diagnostics are publicly readable

- **Severity:** Medium
- **Application:** MarketHub
- **Affected file:** `platform/server/src/app.ts`
- **Affected endpoint:** `GET /health/workers`
- **Evidence:** The route returns worker state and readiness for email, central administrator auth, Daraja payments, and image storage without authentication. It does not expose secret values, but does expose internal operational/configuration state.
- **Impact:** An unauthenticated caller can learn which internal integrations and worker processes are enabled or degraded, improving infrastructure reconnaissance.
- **Remediation:** Public `/health/workers` now returns only `{ "status": "ok" }`; `/health/ready` returns only a generic readiness status. Detailed diagnostics are exposed at the administrator API diagnostics route behind the existing `admins:manage` permission check. Kitz public `/health` and `/health/ready` responses are also generic.
- **Status:** Implemented.
- **Verification:** MarketHub tests assert public bodies omit details and the diagnostics route does not return data when the database is unavailable. The test environment cannot exercise the authorization middleware's database-backed decision; authenticated and unauthenticated diagnostics access with a working DB/Kitz auth service remains unverified. Kitz readiness regression asserts the generic response.

### DB-PREFLIGHT-001: Marketplace runtime sequence privileges were not audited

- **Severity:** Medium
- **Application:** MarketHub
- **Affected file:** `platform/scripts/database-preflight.mjs`
- **Evidence:** Existing read-only preflight checked role attributes, schema access, table DML grants, public-schema isolation, and RLS/policies, but not sequence `USAGE` or runtime sequence ownership.
- **Remediation:** Preflight now records Marketplace sequences and blocks if the runtime role lacks `USAGE` or owns a sequence.
- **Status:** Implemented; live database execution remains blocked by unavailable approved credentials.
- **Verification:** New unit test passes for missing usage and runtime ownership cases.

### DIST-LIMIT-001: Security limits are not shared across instances

- **Severity:** High when horizontally scaled
- **Applications:** Kitz and MarketHub
- **Evidence:** All application rate-limit callsites now use the shared limiter factories. When `REDIS_URL` is configured, node-redis and `rate-limit-redis` use app/policy-specific Redis prefixes. Account-targeted policies store SHA-256 identities, IP policies store SHA-256 normalized IP keys, and global IP caps remain in place.
- **Remediation:** Implemented with Redis-backed production policies, bounded initial connection/command timeouts, disabled offline queuing, bounded reconnection, production startup gating, and HTTP 503 on store failure. No production in-memory fallback exists.
- **Status:** Implemented; not production-verified.
- **Verification:** Kitz and MarketHub tests prove HTTP 503 on counter failure, opaque account/IP keys, and resistance to untrusted forwarded-IP changes when proxy trust is disabled. Two-client/two-server shared-counter and expiry tests exist but were skipped because `REDIS_TEST_URL` and a Redis service are unavailable. Production `REDIS_URL` is not configured.

### AUTH-MFA-001: Privileged administrator MFA is not implemented

- **Severity:** High
- **Applications:** Kitz and MarketHub central administrator integration
- **Evidence:** Kitz administrator password verification issues sessions directly. No MFA schema, TOTP verification, encrypted secret storage, recovery codes, or step-up flow was found. MarketHub delegates administrator authentication to Kitz.
- **Remediation:** Not implemented. A backward-compatible migration and central auth protocol change must be reviewed before MarketHub login can consume MFA challenges without creating a bypass.
- **Status:** Blocked pending migration/authentication design and key-management configuration.

## Not assessed in this pass

Authentication/MFA, authorization and IDOR coverage, CSRF, XSS, SSRF, upload decoding, all payment callback race paths, Kitz database grants/RLS, MarketHub live grants/RLS, secret scanning, dependency advisories, GitHub Actions permissions, Render configuration, backup restoration, incident response, and frontend behavior require dedicated inspection and tests. No clean bill of health or production-readiness certification is implied.
