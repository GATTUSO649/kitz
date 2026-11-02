# KitCulture Security Assessment

**Assessment date:** 2026-11-02  
**Scope:** Read-only source review, dependency audit, and limited read-only checks against the configured Supabase PostgreSQL database and public Render endpoints. No penetration testing, production login, payment initiation, file upload, migration, or destructive testing was performed.

## Executive Summary

KitCulture has substantial application-layer controls: bcrypt password hashes, opaque database-backed sessions stored as SHA-256 digests, HttpOnly/SameSite cookies, origin checks on state-changing flows, bounded request bodies, rate limits, Zod validation, parameterized Drizzle queries, generic production errors, and Daraja callback reconciliation. No known dependency vulnerabilities were reported by `npm audit`.

The review is **not a production security certification**. One active PostgreSQL compatibility defect was reproduced in the public best-sellers endpoint. The connected PostgreSQL role bypasses RLS, so backend authorization and database-secret protection are the effective data boundary. Administrator accounts are all full-access. Production edge/DNS settings, Render secrets, backups/restores, Cloudinary, email, and a real Daraja transaction could not be independently verified.

## Components Inspected

| Component | Evidence reviewed |
| --- | --- |
| Frontend | React/Vite routes and admin/customer/catalogue flows; no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or private API credential references found. Local storage contains the shopping cart and a non-auth visitor rating ID. |
| API/runtime | Express app, middleware, error handler, health endpoints, database diagnostics, request logging, cache, origin authentication, rate limiting. |
| Database | PostgreSQL Drizzle schemas, migration baseline, shared `pg.Pool`, SSL configuration, query patterns, database-backed sessions and audit tables. |
| Authentication | Customer/admin/operations routers, bcrypt policy, registration/login, password reset and email verification, session issuance/renewal/revocation. |
| Authorization | Account ownership predicates, administrator router-wide session requirement, operations session checks, order ownership checks. |
| Payments | Guest/customer checkout, STK Push, callback token, Daraja STK query, amount/order/phone/time verification, transactional success transition. |
| Uploads | Cloudinary signed server-side requests, 8 MiB request limit, JPEG/PNG/WebP signature checks, admin route protection. |
| Email | Resend server-side request, token generation/hashing, expiry, email template escaping, delivery logging. |
| Dependencies/deployment | Root manifest and lockfile, Render/deployment/origin/security docs, `.gitignore`, `npm audit`, production runtime DB role. |

## API Inventory

The table groups routes that share the same router middleware. `validate` means Zod/input constraints were found in the route; it is not a claim that every business scenario has integration coverage. All routes are also under the global API limiter. The auth limiter applies to auth requests and admin register/verify/login; route-specific limiters are noted.

| Methods and endpoints | Authentication / permission | Validation, data and rate limits |
| --- | --- | --- |
| `POST /api/v1/auth/register`, `/login`, `/request-verification`, `/verify-email`, `/forgot-password`, `/reset-password`; `GET /api/v1/auth/me`; `POST /api/v1/auth/session/activity`, `/logout` | Public login/recovery/verification; session required by `/me` and activity. | Zod; passwords bcrypt; token digests stored in DB; auth limiter; state-changing calls check Origin. Generic recovery acknowledgement reduces account enumeration. Registration still distinguishes existing email (LOW finding). |
| `GET /api/v1/account/`, `/profile`, `/addresses`, `/wishlist`, `/notifications/unread-count`, `/notifications`, `/support`, `/support/:id/messages`, `/support/events` | Customer session required by account router. | Reads are user-scoped; messages and personal/address/order data are returned only to the session owner. Pagination/IDs are validated per handler. |
| `PATCH /api/v1/account/profile`, `/addresses/:id`, `/notifications/read-all`, `/notifications/:id/read`, `/security/password`; `POST /api/v1/account/addresses`, `/wishlist`, `/support/:id/messages`, `/support/chat`, `/support`, `/products/:productId/reviews`; `DELETE /api/v1/account/addresses/:id`, `/notifications/:id`, `/support/:id/messages/:messageId`, `/wishlist/:productId` | Customer session required; handlers scope updates/deletes by authenticated user. | Zod and ownership checks; mutations check Origin. Password change verifies current password, rotates bcrypt hash, revokes sessions, and writes audit event. |
| `GET /api/v1/admin/registration-status`, `/me`; `POST /api/v1/admin/register`, `/verify`, `/login`, `/session/activity`, `/logout` | Registration/login public subject to setup secret and verification; authenticated admin session for `/me` and activity. | Admin register/verify/login use auth limiter; secrets/passwords validated; opaque DB sessions; audit login. Signup secret is shared rather than per-invitation. |
| `GET /api/v1/admin/dashboard`, `/products`, `/catalogue-options`, `/homepage`, `/categories`, `/orders`, `/guest-orders`, `/customers`, `/notifications`, `/support`, `/support/:id/messages`, `/inventory/movements`, `/delivery/zones`, `/payments`, `/expenses`, `/reports/financial`, `/settings`, `/audit` | `authenticateAdmin` is mounted for all business routes. No finer admin permissions exist. | Report/query parameters validated and bounded; responses include commerce/customer/payment data. Audit and payment records are admin-only. |
| `POST /api/v1/admin/leagues`, `/leagues/:id/teams`, `/jersey-categories`, `/products`, `/products/:id/images`, `/products/:id/videos`, `/homepage/slides/image`, `/homepage/slides`, `/homepage/slides/batch`, `/delivery/zones`, `/notifications`, `/expenses` | Admin session. | Zod and product/expense schemas; uploads are raw-body limited to 8 MiB and checked by signature; writes use Drizzle and audit events where implemented. |
| `PATCH /api/v1/admin/products/:id`, `/products/:id/images/:imageId`, `/support/:id`, `/homepage/slides/:id`, `/categories/:id`, `/delivery/zones/:id`, `/orders/:id/status`, `/settings`; `POST /api/v1/admin/products/:id/variants/:variantId/stock`; `DELETE /api/v1/admin/products/:id`, `/products/:id/images/:imageId`, `/products/:id/videos/:videoId`, `/homepage/slides/:id`, `/notifications/:id` | Admin session. | Inputs validated; stock updates are conditional and transactional; product unpublish is soft; most mutations record admin audit. No finance/inventory role separation. |
| `GET /api/v1/operations/registration-status`, `/me`, `/operators`, `/overview`, `/incidents`, `/incidents/:id/events`, `/audit`; `POST /api/v1/operations/register`, `/login`, `/logout`, `/session/activity`, `/incidents`, `/incidents/:id/events`; `PATCH /api/v1/operations/incidents/:id` | Separate operations session for protected routes; registration requires server-side setup secret. | Separate login/signup limiters; inputs validated; operational/audit data access is separated from customer/admin sessions. Shared signup secret grants entry but not a self-selected role beyond operations. |
| `GET /api/v1/delivery/zones`, `/orders`, `/orders/:orderNumber`, `/orders/:orderNumber/tracking`; `POST /api/v1/orders`; `POST /api/v1/orders/:orderNumber/mpesa/stk-push`; `POST /api/v1/orders/:orderNumber/cancel` | Delivery zones public; order reads/payment/cancel require customer session and order ownership. | Order/phone inputs validated; idempotency key and bounded cart/quantity; stock/order changes transactional; M-PESA endpoint has a dedicated rate limiter. |
| `GET /api/v1/orders/guest/:orderNumber/status`; `POST /api/v1/orders/guest`, `/orders/guest/:orderNumber/mpesa/stk-push`; `POST /api/v1/orders/mpesa/callback/:token` | Guest endpoints public, using random guest order number and rate limiting; callback public only at an unguessable token path. | Guest order/status/STK limits; callback validates token and body, queries Daraja, and matches payment/order/amount/phone/time. Guest status endpoint reveals limited status/total to anyone holding the order number. |
| `POST /api/v1/products/:productId/ratings`; `GET /api/v1/products`, `/products/featured`, `/products/trending`, `/products/new-arrivals`, `/products/best-sellers`, `/products/:slug`; `GET /api/v1/store/contact`, `/store/payment-options`, `/store/homepage`, `/marketplace`, `/categories` | Public. | Product list query bounds and global limiter; ratings additionally rate-limited but accept client-chosen visitor IDs. Best-sellers PostgreSQL defect/pagination risk is fixed and covered by regression test. |
| `GET /health`, `/health/live`, `/health/ready` | Public. | Readiness exposes only generic DB check names/status; `/health` exposes DB configured/connected booleans. |

## Findings

### MEDIUM: Best-sellers endpoint uses MySQL-only `FIELD()` on PostgreSQL

- **Evidence:** `server/src/modules/catalogue/routes.ts`, `getProducts()` best-seller ordering; `/api/v1/products/best-sellers` passes database-ranked IDs to `FIELD()`.
- **Root cause:** `FIELD()` is a MySQL function and does not exist in PostgreSQL.
- **Verification:** Reproduced against the configured PostgreSQL database; the query fails with SQLSTATE `42883` (`function field(integer, unknown) does not exist`).
- **Impact:** Best-sellers endpoint fails; depending on frontend usage this removes a catalogue section and can generate repeated server errors.
- **Recommended fix:** Replace with PostgreSQL-compatible parameterized ordering (for example `array_position`) while preserving ranked IDs and response shape.
- **Related resource risk:** `listQuery.page` permits 100,000 while `limit` permits 60. The best-seller query requests `page * limit + 1` IDs, potentially asking PostgreSQL to rank/materialize up to six million IDs. Bound page depth and add a regression test.

### MEDIUM: Runtime PostgreSQL role bypasses Row Level Security

- **Evidence:** Read-only inspection found the current role is not a superuser but has `rolbypassrls = true`. The baseline enables RLS without policies; the application connects server-side through one shared pool.
- **Root cause:** Runtime database access bypasses table RLS, making application authorization and server-secret protection the actual isolation boundary.
- **Impact:** A stolen runtime connection string or server compromise can access all granted application rows; RLS is not a containment layer for this role.
- **Recommended remediation:** Database owner should create/assign a dedicated least-privilege runtime role with only required schema/table permissions; separately assess whether RLS policies are suitable for the app's single trusted backend. Do not remove bypass or alter grants without staging and owner approval because it can break runtime operations.
- **Potential functionality impact:** Incorrectly removing privileges can take down all database-backed workflows.

### MEDIUM: No fine-grained administrator permissions

- **Evidence:** `docs/security.md` documents that all administrator accounts have the same full access; `requireRole()` exists but is not used by admin feature routes.
- **Root cause:** Admin endpoints distinguish authenticated administrator from unauthenticated users, but not finance, inventory, or other capabilities.
- **Impact:** Compromise or misuse of any admin session permits all admin operations exposed by the API, including product/inventory/order/settings and financial/reporting functions.
- **Recommended remediation:** Define least-privilege roles and map sensitive routes/actions only after business owners approve a permission matrix. Add server-side authorization tests. Do not silently assign roles or change existing workflow access.

### LOW: Public quick ratings can be manipulated with client-chosen identities

- **Evidence:** `server/src/modules/catalogue/routes.ts` accepts a visitor ID from the request and upserts one rating per `(productId, visitorId)`; the endpoint has a process-local rate limit.
- **Root cause:** The visitor identifier is not a server-verifiable identity and can be changed by a caller.
- **Impact:** Ratings can be inflated or manipulated; rate limits constrain request volume per process but not distinct identities or multiple instances.
- **Recommended remediation:** Treat quick ratings as non-authoritative engagement data, or require stronger identity/abuse controls before using them for ranking or business decisions. Do not change the rating contract without product approval.

### LOW: Registration response reveals whether an email is already registered

- **Evidence:** `server/src/modules/auth/routes.ts`, `/register` returns HTTP 409 for an existing email and HTTP 201 for a newly created account.
- **Root cause:** Registration has a pre-insert account-existence check with distinguishable status codes.
- **Impact:** An unauthenticated caller can test whether specific email addresses have accounts.
- **Recommended remediation:** Use a uniform acknowledgement and deliver account-specific next steps by email, if the product owner approves the response-contract change. Keep the existing API contract until that approval is given.

### LOW: Uploaded images are signature-checked but not decoded/re-encoded

- **Evidence:** `server/src/modules/admin/image-storage.ts` allows JPEG/PNG/WebP by magic bytes and caps input at 8 MiB before forwarding it to Cloudinary.
- **Root cause:** A valid signature does not establish that the full image is well-formed or has safe decoded dimensions.
- **Impact:** Malformed or unusually complex image files could consume provider processing resources. Uploads require administrator authentication and are size-limited, which reduces exposure.
- **Recommended remediation:** Consider bounded image decoding/re-encoding and dimension limits if upload abuse or provider processing risk justifies an image library. This adds a dependency and needs compatibility testing.

### LOW: Public `/health` reveals database availability booleans

- **Evidence:** `server/src/app.ts` returns `databaseConfigured`, `databaseConnected`, and `adminDatabaseConnected` from `/health`; `/health/ready` only returns generic check status.
- **Impact:** Reveals limited infrastructure state to unauthenticated callers; no credentials, host, schema, or SQL are returned.
- **Recommended remediation:** Prefer `/health/ready` for public platform probes and consider reducing `/health` to service liveness if no external consumer needs the detailed booleans.

### INFORMATIONAL: Legacy MySQL dependency and configuration remain

- **Evidence:** `mysql2` is a direct dependency; MySQL schema snapshots, migrations, TLS helpers, fallback environment parsing, and Drizzle config remain. No active runtime import of `mysql2` was found in the application modules reviewed.
- **Impact:** Additional dependency/maintenance surface and potential future configuration confusion; not a known vulnerability (`npm audit` reports zero advisories).
- **Recommendation:** Remove only after the MySQL rollback/data-migration decision is complete and the original source database is safely retired.

### INFORMATIONAL: Deployment and operational security require external verification

- **Evidence:** `docs/origin-security.md` records that Render/Cloudflare hostnames, DNS proxy coverage, WAF, TLS mode, origin reachability, and account settings are unknown. Backup restore and production payment end-to-end checks are documented as incomplete. Current production email delivery is disabled and `APP_URL` is unset in this environment.
- **Impact:** Network-origin protections, disaster recovery, transactional email, and live Daraja behavior cannot be certified from repository tests.
- **Recommendation:** Verify provider settings in authorized dashboards, configure `APP_URL` before enabling email, restore-test backups, and perform an approved low-value Daraja transaction with callback reconciliation before accepting live commerce.

## Controls Observed

- Passwords use bcrypt with a 14-character minimum and 72-byte bcrypt input cap; login uses a dummy hash for unknown users.
- Customer/admin/operations sessions use random opaque tokens stored as SHA-256 digests, HttpOnly cookies, `SameSite=Strict`, `Secure` in production, idle and absolute expiry, and server-side revocation.
- Password reset tokens are hashed, expire, are consumed under a transaction/row lock, and revoke customer sessions.
- State-changing authentication/account/order actions perform Origin checks; CORS is restricted to the configured client origin; Express JSON is limited to 100 KiB; API/auth/payment/guest flows have rate limits.
- Helmet CSP and other headers are configured; production errors are generic and logs redact URLs, cookies, authorization headers, origin tokens, and sensitive fields.
- Drizzle parameterizes query values. Order stock reservations and payment confirmation use transactions and conditional updates. Customer order reads/cancel/tracking filter by authenticated user ID.
- M-PESA does not trust a browser success response: callback token, provider STK query, receipt, amount, order, currency, payer, and timestamp are checked; payment/order success is transactional and idempotent.
- Cloudinary uploads are admin-protected, signed server-side, limited to 8 MiB, and checked against JPEG/PNG/WebP signatures.
- `.env` is ignored and not tracked. No frontend secret/env references were found in source.

## Checks Run

- `npm audit`: zero known vulnerabilities across production and development dependencies.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities.
- `npm test`: not yet run as part of this initial read-only assessment.
- PostgreSQL read-only query checks: admin products query groups passed; admin orders and payment queries passed; best-sellers `FIELD()` ordering failed with SQLSTATE `42883`.
- PostgreSQL role inspection: not superuser; `BYPASSRLS` enabled.
- Live Render unauthenticated `/api/v1/admin/products` and `/api/v1/admin/orders` returned expected `401`; authenticated endpoint behavior was not tested.
- Live M-PESA payment options report STK unavailable; no payment was initiated.
- Production DNS/Cloudflare/Render environment, backup restoration, Cloudinary, email, and live Daraja transaction were not independently verified.

## Initial Remediation Plan

1. Replace `FIELD()` with PostgreSQL-compatible ranked ordering and cap public pagination to a practical maximum; test the sort and boundary behavior.
2. Leave permissions, schema, live credentials, RLS policy, administrator roles, and provider settings unchanged pending owner approval and staging verification.
3. Run the existing tests, typecheck, lint, dependency audit, and production build after the safe code fix.
4. Update this report with actual verification results and remaining operational risks.

## Remediation and Final Verification

- Replaced MySQL `FIELD()` ordering with PostgreSQL `array_position()` in `server/src/modules/catalogue/routes.ts`.
- Reduced the accepted catalogue page ceiling from 100,000 to 100. Added an app-level regression test that page 101 is rejected before database access in `server/src/app.test.ts`.
- Reproduced the exact replacement ranking query against the configured PostgreSQL database; it succeeded. The prior `FIELD()` query failed with SQLSTATE `42883`.
- `npm test`: 97 passed, 0 failed.
- `npm run typecheck`: passed.
- `npm run build:deploy`: passed. Vite emitted a nonfatal warning that the local `.env` sets `NODE_ENV` for a production build; this environment file was not modified.
- `npm run lint`: completed with 12 existing React hook warnings in frontend files; no catalogue remediation lint errors.
- `npm audit` and `npm audit --omit=dev`: zero known vulnerabilities.
- No authentication, authorization, payment, database permission/schema, production secret, or customer data was changed. No migration or external payment request was run.
- Worktree changes for this assessment are the report, catalogue query/pagination fix, and regression test.

## Readiness

**NOT READY for an unconditional production-security claim.** Source controls are substantial, but the reproduced best-sellers failure must be fixed, runtime RLS bypass requires an explicit database-owner risk decision, administrators have broad shared access, and backups, edge configuration, and live payment reconciliation remain externally unverified.