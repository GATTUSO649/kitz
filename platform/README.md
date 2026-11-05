# MarketHub Platform

This application is intentionally independent from the protected KitCulture/Kitz application. The original repository state is recorded at commit `090007cd0a71f33581c7075f95dfe44bee9e206d`; all new source, schema, build and deployment settings live under `platform/`.

## Routes

- `/` is the shared platform entry.
- `/kits` redirects to `VITE_KITZ_ORIGIN` (defaults to the existing `https://kitz.onrender.com` origin).
- `/marketplace` is the new independent second-hand marketplace.
- `/marketplace/sell` is the multi-step anonymous listing workflow.
- `/marketplace/products/:slug` is a public listing detail page. Seller contact is returned only by the protected entitlement endpoint after verified contact payment.
- `/admin/marketplace/login` and `/admin/marketplace/dashboard` use separate marketplace administrator sessions and role permissions.

## Local Development

Use Node.js 22 or newer and install from this directory so the Kitz package/dependency tree is not changed:

```powershell
cd platform
npm install
Copy-Item .env.example .env
npm run dev:all
```

The platform frontend uses Vite on port 5173 and proxies `/api` and `/health` to the separate API on port 4001. Without `MARKETPLACE_DATABASE_URL`, data routes and readiness return `503`; no sample marketplace listings are substituted. The shared entry and route shell still load. PostgreSQL credentials are server-only and must never use a `VITE_` variable.

MarketHub uses the existing Supabase PostgreSQL database with `MARKETPLACE_DATABASE_NAME=postgres` and `MARKETPLACE_DATABASE_SCHEMA=marketplace`. Set `MARKETPLACE_DATABASE_URL` to a server-side connection string for a dedicated least-privilege MarketHub runtime role, and set `MARKETPLACE_DATABASE_USER` and `MARKETPLACE_DATABASE_HOST` to the exact user and hostname in that URL. Grant that role `USAGE` on `marketplace`, required DML on its tables, and sequence usage only; do not grant it access to `public` or use Supabase's `postgres` owner role for runtime. `MARKETPLACE_DATABASE_SCHEMA` must be exactly `marketplace`. Production requires `MARKETPLACE_DATABASE_CA` and verified TLS; certificate verification cannot be disabled. The one-off `MARKETPLACE_MIGRATION_DATABASE_URL` is reserved for an operator-controlled migration role and is not required in the Render runtime environment. Do not configure a second Supabase project or use Kitz API/service credentials as the database role.

## Marketplace Database

Every MarketHub table and foreign key is declared in the PostgreSQL `marketplace` schema. Drizzle migration history and generated migration files are isolated under `server/src/database/marketplace-migrations`; the legacy `server/src/database/migrations` files are retained for history and must not be replayed against the shared Supabase database. The marketplace schema contains categories, subcategories, counties, products, private seller records, product images, payments, callbacks, unlock entitlements, administrator sessions, reports, analytics, settings and audit records. Search remains available without installing extensions or modifying the existing `public` schema.

Review generated SQL before executing it and confirm every created object is qualified with `marketplace`. The migration role must be able to create the schema and objects; the runtime role must remain separate and limited to `marketplace`. `npm run db:migrate` is an explicit operator action and migrations are never run at API startup. Do not use reset or drop commands against the shared database. Existing tables in legacy `public` are not moved automatically; the new baseline aborts if it finds `public.marketplace_*` relations or existing marketplace tables, so inspect the live catalog and plan a separately reviewed, data-preserving move only if those objects are confirmed to be MarketHub-owned. No migration has been applied by this workspace task.

## Storage and Payments

Product images use a separate persistent Cloudinary configuration: `MARKETPLACE_CLOUDINARY_CLOUD_NAME`, `MARKETPLACE_CLOUDINARY_API_KEY` and `MARKETPLACE_CLOUDINARY_API_SECRET`. Upload requests are byte-limited, signature/dimension checked, tied to the anonymous listing token, and capped at five images. Cloudinary performs the decode/derived transformation; verify the account's upload and deletion behavior in staging.

Daraja is disabled unless `MPESA_ENV=sandbox` or `production` and the required marketplace-specific secrets are configured. Never put credentials in `VITE_` variables. The registered callback must exactly match `MPESA_CALLBACK_URL` and include the secret route token. STK acceptance is only `pending`; a listing publishes or an unlock entitlement is created only after callback metadata matches the stored amount/phone/provider request and a Daraja STK query confirms success. No production merchant approval, credentials, callback registration or payment has been verified here. Keep production mode disabled until those external gates pass.

Publication and contact-unlock fees default to 1,000 and 500 basis points in marketplace database settings. Values are integer rates; fees round up to whole KSh. The server—not the browser—calculates amounts.

## Marketplace Administrator Bootstrap

The admin API has separate `super_admin`, `product_admin`, `finance_admin` and `support_admin` permissions. Provision the first Super Admin once, using secret-manager or shell-only temporary values:

```powershell
$env:MARKETPLACE_ADMIN_EMAIL = 'admin@example.com'
$env:MARKETPLACE_ADMIN_PASSWORD = '<operator-supplied strong password>'
npm run admin:provision
Remove-Item Env:MARKETPLACE_ADMIN_EMAIL
Remove-Item Env:MARKETPLACE_ADMIN_PASSWORD
```

Do not commit these values or put them in the browser environment. The bootstrap command refuses to create another Super Admin if one already exists. Further admin invitations/role editing are not yet exposed in the UI/API and must not be simulated by direct production database edits.

## Build and Tests

```powershell
npm run typecheck
npm test
npm run lint
npm run build
npm run build:server
npm run build:deploy
```

`build:deploy` compiles the React app and API; the Express server serves `dist/` and client routes when present. Health endpoints are `/health/live` and `/health/ready`.

## Deployment Boundary and Outstanding Gates

Deploy `platform/` as a separate service/origin with HTTPS, exact `PLATFORM_ORIGIN`, build-time `VITE_KITZ_ORIGIN`, the five runtime database settings (`MARKETPLACE_DATABASE_URL`, `MARKETPLACE_DATABASE_NAME=postgres`, `MARKETPLACE_DATABASE_HOST`, `MARKETPLACE_DATABASE_USER`, `MARKETPLACE_DATABASE_SCHEMA=marketplace`) plus verified `MARKETPLACE_DATABASE_CA`, the marketplace Cloudinary namespace, and marketplace-specific secrets. Do not put database credentials in any `VITE_` variable. `/kits` navigates to the existing Kitz origin without path-prefix rewriting or source changes. The single-origin `/kits/*` reverse-proxy option is intentionally not used because Kitz uses root-based assets, routes and APIs.

This implementation is a working isolated foundation, not a production-complete commercial platform. No external marketplace database/storage/payment service has been provisioned or exercised. Remaining work includes marketplace admin invitation/role management and full reports/support/settings/audit interfaces, advanced buyer filters/grid/list modes and location administration, refund/reconciliation workflows, notification delivery, expiry/retention jobs, comprehensive PostgreSQL integration and concurrency tests, distributed rate-limit storage, staging verification of image decode/storage and all Daraja callback cases, backup/restore and rollback rehearsal, production secrets/domain/monitoring setup, and security review. Do not enable live payments or represent deployment as production-ready until these gates are closed.
