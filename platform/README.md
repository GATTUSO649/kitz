# MarketHub Platform

This application is intentionally independent from the protected KitCulture/Kitz application. The original repository state is recorded at commit `090007cd0a71f33581c7075f95dfe44bee9e206d`; all new source, schema, build and deployment settings live under `platform/`.

## Routes

- `/` is the shared platform entry.
- `/kits` redirects to `VITE_KITZ_ORIGIN` (defaults to the existing `https://kitz.onrender.com` origin).
- `/marketplace` is the new independent second-hand marketplace.
- `/marketplace/sell` is the multi-step anonymous listing workflow.
- `/marketplace/seller/signup`, `/marketplace/seller/login` and `/marketplace/seller` provide verified seller accounts and an account-scoped product dashboard.
- `/marketplace/products/:slug` is a public listing detail page. Seller contact is returned only by the protected entitlement endpoint after verified contact payment.
- `/admin/marketplace/login` and `/admin/marketplace/dashboard` use a MarketHub session bound to a verified Kitz administrator identity; Kitz remains authoritative for credentials, status, roles, approvals, and permissions.

## Local Development

Use Node.js 22 or newer and install from this directory so the Kitz package/dependency tree is not changed:

```powershell
cd platform
npm install
Copy-Item .env.example .env
npm run dev:all
```

The platform frontend uses Vite on port 5173 and proxies `/api` and `/health` to the separate API on port 4001. Without `MARKETPLACE_DATABASE_URL`, data routes and readiness return `503`; no sample marketplace listings are substituted. The shared entry and route shell still load. PostgreSQL credentials are server-only and must never use a `VITE_` variable.
Daraja is disabled unless `MARKETPLACE_DARAJA_ENVIRONMENT=sandbox` or `production` and the required `MARKETPLACE_DARAJA_*` secrets are configured. Reuse the existing Daraja account values in MarketHub's Render secret manager; never put credentials in `VITE_` variables. Each MarketHub STK request supplies its own tokenized callback URL, routing to the MarketHub callback route; Kitz retains its existing `/api/v1/orders/mpesa/callback/...` URL. Confirm per-request callbacks are enabled for the existing shortcode before production activation. STK acceptance is only `pending`; a listing publishes or an unlock entitlement is created only after callback metadata matches the stored amount/phone/provider request and a Daraja STK query confirms success. For production `CustomerBuyGoodsOnline`, set `MARKETPLACE_DARAJA_TILL_NUMBER` to the approved receiving Till; the business shortcode remains `MARKETPLACE_DARAJA_SHORTCODE`. For `CustomerPayBillOnline`, `PartyB` remains the business shortcode. Keep production mode disabled until merchant approval, credentials, callback registration, and a controlled verification payment have been confirmed.
MarketHub uses the existing Supabase PostgreSQL database with `MARKETPLACE_DATABASE_NAME=postgres` and `MARKETPLACE_DATABASE_SCHEMA=marketplace`. Set `MARKETPLACE_DATABASE_URL` to a server-side connection string for a dedicated least-privilege MarketHub runtime role, and set `MARKETPLACE_DATABASE_USER` and `MARKETPLACE_DATABASE_HOST` to the exact user and hostname in that URL. Grant that role `USAGE` on `marketplace`, required DML on its tables, and sequence usage only; do not grant it access to `public` or use Supabase's `postgres` owner role for runtime. `MARKETPLACE_DATABASE_SCHEMA` must be exactly `marketplace`. Production requires `MARKETPLACE_DATABASE_CA` and verified TLS; certificate verification cannot be disabled. The one-off `MARKETPLACE_MIGRATION_DATABASE_URL` is reserved for an operator-controlled migration role and is not required in the Render runtime environment. Do not configure a second Supabase project or use Kitz API/service credentials as the database role.

## Marketplace Database

Every MarketHub table and foreign key is declared in the PostgreSQL `marketplace` schema. Drizzle migration history and generated migration files are isolated under `server/src/database/marketplace-migrations`; the legacy `server/src/database/migrations` files are retained for history and must not be replayed against the shared Supabase database. The marketplace schema contains categories, subcategories, counties, products, private seller records, product images, payments, callbacks, unlock entitlements, administrator sessions, reports, analytics, settings and audit records. Search remains available without installing extensions or modifying the existing `public` schema.

Review generated SQL before executing it and confirm every created object is qualified with `marketplace`. The migration role must be able to create the schema and objects; the runtime role must remain separate and limited to `marketplace`. `npm run db:migrate` is an explicit operator action and migrations are never run at API startup. Do not use reset or drop commands against the shared database. Existing tables in legacy `public` are not moved automatically; the new baseline aborts if it finds `public.marketplace_*` relations or existing marketplace tables, so inspect the live catalog and plan a separately reviewed, data-preserving move only if those objects are confirmed to be MarketHub-owned. No migration has been applied by this workspace task.

## Storage and Payments

Product images use a separate persistent Cloudinary configuration: `MARKETPLACE_CLOUDINARY_CLOUD_NAME`, `MARKETPLACE_CLOUDINARY_API_KEY` and `MARKETPLACE_CLOUDINARY_API_SECRET`. Upload requests are byte-limited, signature/dimension checked, tied to the anonymous listing token, and capped at five images. Cloudinary performs the decode/derived transformation; verify the account's upload and deletion behavior in staging.

MarketHub uses application-specific email templates and an outbox in `marketplace.marketplace_email_events`. Production requires `MARKETPLACE_EMAIL_PROVIDER=smtp` with the same Brevo SMTP host, port, user, password, and verified sender configured for Kitz; production rejects Resend and disabled email. Configure these values only in the two Render service secret managers, never in Vite variables. Development/test may use the configured Resend adapter. The outbox deduplicates events, bounds retries with jitter for explicit temporary provider rejections, preserves failed rows for audited requeue, and does not automatically resend uncertain outcomes where duplicate delivery is possible. `sent` means the provider accepted the message, not that the recipient mailbox confirmed delivery.

Both background workers use the same validated `MARKETPLACE_DATABASE_URL` and least-privilege runtime role as the API. Apply the reviewed migrations under `server/src/database/marketplace-migrations` before deploying code that requires their tables; never replay the legacy `server/src/database/migrations` tree. `/health/workers` reports worker enablement, last run/success/failure timestamps and consecutive failure counts. `/health/ready` verifies the complete marketplace relation set and runtime privileges. Database failures use bounded exponential backoff independently; worker and API logs include sanitized PostgreSQL codes/messages and pool counts while redacting URLs, passwords, tokens and certificates. Email delivery attempts are counted on each `marketplace_email_events` row; there is no separate delivery-attempt table.

The only migration target is the shared database's `marketplace` schema. Review the SQL under `server/src/database/marketplace-migrations` and confirm `MARKETPLACE_MIGRATION_DATABASE_URL`, `MARKETPLACE_DATABASE_NAME`, `MARKETPLACE_DATABASE_HOST` and `MARKETPLACE_DATABASE_SCHEMA=marketplace` identify the intended target. Then run `npm run db:migrate` manually from `platform/` using the dedicated migration role. Do not use the runtime connection, legacy `server/src/database/migrations`, reset commands, or app startup to apply migrations. Production migration execution is not part of build or deploy.

Daraja is disabled unless `MARKETPLACE_DARAJA_ENVIRONMENT=sandbox` or `production` and the required `MARKETPLACE_DARAJA_*` secrets are configured. Use the same existing Safaricom account values configured on Kitz; never put credentials in `VITE_` variables. Kitz and MarketHub keep separate callback routes, references, ledgers, callback tokens, and `application_id` values constrained to `KITZ` and `MARKETHUB`. The registered MarketHub callback must exactly match `MARKETPLACE_DARAJA_CALLBACK_URL` and include its secret route token. For production Buy Goods, set `MARKETPLACE_DARAJA_TILL_NUMBER` to the authorized receiving Till; STK uses it as `PartyB`, while `MARKETPLACE_DARAJA_SHORTCODE` remains `BusinessShortCode`. STK acceptance is only `pending`; callback metadata and a Daraja STK query must both verify before settlement. Keep production disabled until the credentials, merchant settings, callback registration, and a controlled payment are confirmed.

Publication and contact-unlock fees default to 1,000 and 500 basis points in marketplace database settings. Values are integer rates; fees round up to whole KSh. The server—not the browser—calculates amounts. Published listings default to a seven-day visibility period, configurable from 1 to 365 days by a marketplace Super Admin. Changing the setting recalculates expiry for currently published listings from their original publication timestamp; expired listings are hidden immediately and marked `expired` by the worker, while their database records remain for audit/reporting.

Set `MARKETPLACE_DARAJA_CALLBACK_URL` to `https://<markethub-host>/api/v1/marketplace/payments/callback/<MARKETPLACE_DARAJA_CALLBACK_TOKEN>`. The callback token must be random and at least 32 characters; the configured URL path must match exactly. Do not unregister or replace Kitz's callback.

## Marketplace Administrator Bootstrap

Kitz Super Admin is the only administrator provisioning, verification, approval, role, permission, suspension, and reactivation authority. Invite Marketplace roles from the Kitz Super Admin dashboard. MarketHub verifies submitted credentials and each protected permission over the authenticated server-to-server Kitz API; it does not trust browser-supplied roles or maintain administrator passwords. The old local bootstrap command is intentionally disabled. Existing MarketHub administrator rows are retained and are linked to Kitz identities at first successful central sign-in; rows without a valid central Kitz identity cannot create a session.

Configure the same random `MARKETHUB_SERVICE_TOKEN` in both Kitz and MarketHub server environments. On MarketHub set `KITCULTURE_MARKETPLACE_AUTH_URL` and `KITCULTURE_MARKETPLACE_AUTHORIZE_URL` to the exact Kitz `/api/v1/admin/marketplace/authenticate` and `/authorize` HTTPS endpoints. If Kitz's origin-auth gate is enabled, also configure `KITCULTURE_ORIGIN_AUTH_TOKEN` with the Kitz `ORIGIN_AUTH_TOKEN`. Set build-time `VITE_MARKETHUB_ORIGIN` in Kitz to the public MarketHub origin and `MARKETHUB_PUBLIC_URL` in Kitz to that same HTTPS origin. None of these service tokens belong in `VITE_` variables.

## Build and Tests

```powershell
npm run typecheck
npm test
npm run lint
npm run build
npm run build:server
npm run build:deploy
```

`build:deploy` compiles the React app and API; the Express server serves `dist/` and client routes when present. Health endpoints are `/health/live`, `/health/ready`, and `/health/workers`.

## Deployment Boundary and Outstanding Gates

Deploy `platform/` as a separate service/origin with HTTPS, exact `PLATFORM_ORIGIN`, build-time `VITE_KITZ_ORIGIN`, the five runtime database settings (`MARKETPLACE_DATABASE_URL`, `MARKETPLACE_DATABASE_NAME=postgres`, `MARKETPLACE_DATABASE_HOST`, `MARKETPLACE_DATABASE_USER`, `MARKETPLACE_DATABASE_SCHEMA=marketplace`) plus verified `MARKETPLACE_DATABASE_CA`, the marketplace Cloudinary namespace, and marketplace-specific secrets. Also set the Kitz auth/authorize HTTPS endpoints, shared `KITCULTURE_MARKETPLACE_SERVICE_TOKEN`, shared Brevo SMTP credentials/sender, and the same existing Daraja credentials using the MarketHub-specific variable names. Kitz requires the matching `MARKETHUB_SERVICE_TOKEN`, public MarketHub origin, and Brevo SMTP configuration; its Vite build requires `VITE_MARKETHUB_ORIGIN`. Do not put secrets in `VITE_` variables. `/kits` navigates to the existing Kitz origin without path-prefix rewriting or source changes. The single-origin `/kits/*` reverse-proxy option is intentionally not used because Kitz uses root-based assets, routes and APIs.

The central administrator and seller recovery implementations are source-complete but not production-verified. Required operator actions remain: review/apply the additive Kitz migrations and MarketHub migration `0005_central_admin_payments_seller_recovery.sql` through their established controlled workflows; populate matching service, Brevo, and Daraja secrets in Render; link reviewed existing Kitz Marketplace admin identities; and run staging invitation, approval/rejection, suspension, seller reset, email, payment callback, reconciliation, and Kitz regression tests. No production database, Render secret, sender-domain, live payment, callback registration, or restore procedure was verified by this task. Other commercial readiness gaps include image storage verification, refunds/reconciliation operations, distributed rate limiting, backup/restore and rollback rehearsal, monitoring, and security review. Do not enable live payments or claim production readiness until these gates are closed.
