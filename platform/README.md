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

The platform frontend uses Vite on port 5173 and proxies `/api` and `/health` to the separate API on port 4001. Without `MARKETPLACE_DATABASE_URL`, data routes and readiness return `503`; no sample marketplace listings are substituted. The shared entry and route shell still load.

Set `MARKETPLACE_DATABASE_URL` and `MARKETPLACE_DATABASE_NAME` only after provisioning a dedicated PostgreSQL database whose name ends with `marketplace`. The connection URL database name must match the separate name setting. Production additionally requires `MARKETPLACE_DATABASE_CA`; TLS certificate verification cannot be disabled. Never point marketplace runtime or Drizzle commands at Kitz/Supabase credentials.

## Marketplace Database

Drizzle schema and migration history are isolated under `server/src/database`. The initial migrations create marketplace-only categories, subcategories, all 47 county rows, products, private seller records, product images, payments, callbacks, unlock entitlements, administrator sessions, reports, analytics, settings and audit records. Search/filter indexes include PostgreSQL `pg_trgm`; the migration role must be authorized to install that extension in the dedicated database.

Review every SQL migration before executing it. Create and restore-test a backup of the new marketplace database, verify its name/endpoint, then run `npm run db:migrate` from `platform/`. Migrations are never run at API startup. No migration has been applied by this workspace task.

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

Deploy `platform/` as a separate service/origin with HTTPS, exact `PLATFORM_ORIGIN`, build-time `VITE_KITZ_ORIGIN`, a dedicated marketplace PostgreSQL database/role, the marketplace Cloudinary namespace, and marketplace-specific secrets. `/kits` navigates to the existing Kitz origin without path-prefix rewriting or source changes. The single-origin `/kits/*` reverse-proxy option is intentionally not used because Kitz uses root-based assets, routes and APIs.

This implementation is a working isolated foundation, not a production-complete commercial platform. No external marketplace database/storage/payment service has been provisioned or exercised. Remaining work includes marketplace admin invitation/role management and full reports/support/settings/audit interfaces, advanced buyer filters/grid/list modes and location administration, refund/reconciliation workflows, notification delivery, expiry/retention jobs, comprehensive PostgreSQL integration and concurrency tests, distributed rate-limit storage, staging verification of image decode/storage and all Daraja callback cases, backup/restore and rollback rehearsal, production secrets/domain/monitoring setup, and security review. Do not enable live payments or represent deployment as production-ready until these gates are closed.
