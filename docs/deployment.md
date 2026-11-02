# Deployment

> **Database mode:** The active application adapter is now PostgreSQL/Supabase. The MySQL deployment instructions below describe the preserved legacy/source environment and rollback path; do not use their MySQL `DATABASE_URL` with the current runtime. The Supabase schema exists but source data has not been imported, so do not switch production traffic. Follow [Supabase PostgreSQL migration status](supabase-postgresql.md).

## Build and run

Use `npm ci` to install dependencies, `npm run build:deploy` to build the Vite client and compile the API, and `npm run start:server` to start the compiled server. The frontend output is in `dist`; the API entry point is `server/dist/server.js`. When `dist/index.html` exists, the server serves the frontend, generated assets, and client-side routes alongside the API on the same origin. Set `NODE_ENV=production` for secure cookies and verified MySQL TLS, and use the platform-provided `PORT`.

The frontend uses relative `/api/...` requests. Keeping the storefront and API on the same public origin lets session cookies and the Daraja callback use one HTTPS host. Set `CLIENT_ORIGIN` to that exact storefront origin. Do not expose the API's internal port directly to the internet.

## Performance delivery

Vite production builds minify JavaScript and CSS and split lazy routes into hashed assets. The server serves hashed files under `/assets/` with a one-year immutable cache, other static files for one hour, and the HTML shell with `no-cache`. Express compresses eligible responses when the client supports gzip or Brotli. Public catalogue GET responses use a bounded, per-process 10-second cache and a short browser cache; account, admin, order, and payment routes are excluded. Each app instance has its own in-memory cache, so it is intentionally short-lived and is not a shared CDN cache.

Cloudinary images use automatic format/quality and responsive widths. Supported Adidas image URLs use the provider's width parameter; other third-party images are left unchanged. Upload oversized product images to a configured image CDN such as Cloudinary for consistent responsive delivery. The brand mark is served as WebP.

Configure a CDN and load balancer at the hosting/DNS layer; this repository cannot provision them. Cache hashed static assets and public catalogue responses only. Keep API and storefront on the same HTTPS origin, forward session cookies and `/api` paths unchanged, and use `/health/ready` as the load-balancer readiness check. Do not cache authenticated or transactional API responses.

## Render

Create one Node web service from the repository root. Use build command `npm ci --include=dev && npm run build:deploy`, start command `npm run start:server`, and health check path `/health/ready`. The readiness endpoint returns 503 when MySQL is unavailable so Render does not route traffic to an instance that cannot serve commerce requests. Use `/health/live` for process liveness checks. The explicit `--include=dev` is required because `NODE_ENV=production` otherwise makes npm omit TypeScript, Vite, and other build-time dependencies during `npm ci`. Set `NODE_ENV=production`; Render supplies `PORT` automatically. The database URL must point to TLS-enabled MySQL; this app does not use Render's PostgreSQL databases.

Set `CLIENT_ORIGIN` to the storefront's public HTTPS origin and `MPESA_CALLBACK_URL` to the exact callback URL registered with Safaricom, on that same Render service. Keep the storefront and API on one origin. Add database and payment credentials as Render environment variables, never as `VITE_` variables or committed files. If Railway's public MySQL endpoint requires a provider CA, verify it through Railway and set `MYSQL_SSL_CA` in Render to the trusted PEM. Do not deploy if the certificate chain or hostname cannot be verified; production requires `MYSQL_SSL_VERIFY=true` and startup rejects `false`.

Production starts only when all required live Daraja settings are explicit and consistent; it never falls back to Sandbox. Follow [M-Pesa Daraja Setup](mpesa-setup.md) to select PayBill versus Buy Goods and register the exact callback URL. Local `.env` values are not deployed to Render.

Use one Railway MySQL database for storefront and administrator tables. For a Render-hosted app, set `DATABASE_URL` to Railway's `MYSQL_PUBLIC_URL` (public proxy host and port, database `railway`); never use `localhost` or Railway's private `MYSQL_URL` from Render. The app also accepts `MYSQL_PUBLIC_URL` directly when `DATABASE_URL` is absent and uses the same pool for both feature areas. Set `NODE_ENV=production`, `MYSQL_SSL_VERIFY=true`, `CLIENT_ORIGIN` to the current storefront's public HTTPS origin, and `LOG_LEVEL=info`; let Render provide `PORT`. Remove stale `ADMIN_DATABASE_URL` values. If the provider CA is not in Node's trust store, set `MYSQL_SSL_CA` to the verified provider CA PEM. Production now refuses `MYSQL_SSL_VERIFY=false`; do not disable certificate verification. If the app is hosted inside Railway instead, use the database service's private `MYSQL_URL` through Railway's variable reference. Do not configure a separate admin database. Store optional `ADMIN_SIGNUP_SECRET` and `OPERATIONS_SIGNUP_SECRET` only in Render's server-side secret manager and keep them separate. Back up and inspect the live schema before applying migrations. The current storefront and admin migration histories share Drizzle's default tracking table, and the existing admin migration timestamp predates the latest storefront migration, so `db:migrate:all` is not a safe way to reconcile an existing shared database. Do not run it until the migration histories have been reconciled and the pending SQL reviewed. Never run migrations automatically at API startup.

## Stable Daraja callback

Give the service a stable hostname on a domain you control, terminate TLS at Render or a trusted reverse proxy, and keep `/api/v1/orders/mpesa/callback/*` on that same service without rewriting the path. Do not use localhost, a temporary tunnel, or an expiring preview hostname for production callbacks.

Set these in the deployment platform's server-side environment/secret manager, never in Vite variables or source control:

```env
NODE_ENV=production
MPESA_ENV=production
MPESA_CALLBACK_URL=https://your-domain.example/api/v1/orders/mpesa/callback/<same-token>
MPESA_CALLBACK_TOKEN=<random URL-safe secret, 32-128 characters>
MPESA_CONSUMER_KEY=<Safaricom-issued production consumer key>
MPESA_CONSUMER_SECRET=<Safaricom-issued production consumer secret>
MPESA_PASSKEY=<production passkey>
MPESA_TRANSACTION_TYPE=<approved CustomerPayBillOnline or CustomerBuyGoodsOnline>
MPESA_SHORTCODE=<Safaricom-approved production shortcode>
MPESA_ACCOUNT_REFERENCE=KitCulture
MPESA_TRANSACTION_DESC=Jersey Purchase
CLIENT_ORIGIN=https://your-domain.example
DATABASE_URL=<TLS-enabled Railway MySQL URL>
LOG_LEVEL=info
# MYSQL_SSL_CA=<optional PEM CA certificate for the MySQL provider>
# CLOUDINARY_CLOUD_NAME=<optional>
# CLOUDINARY_API_KEY=<optional>
# CLOUDINARY_API_SECRET=<optional>
```

`PORT` is supplied by Render; do not hard-code it. To provision the initial administrator, set `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` temporarily when running `npm run admin:provision`, then remove `ADMIN_PASSWORD`. These are not runtime web-service variables.

When `NODE_ENV=production`, the MySQL pool requires TLS and verifies the server certificate. `MYSQL_SSL_CA` adds the provider CA to the MySQL TLS trust configuration when it is not in Node.js's system certificate store. Verify the CA chain and that the certificate subject alternative name matches the configured database hostname. Verify the CA through Railway before adding it to Render; never copy an unverified peer certificate as a trust anchor. The service startup fails if `MYSQL_SSL_VERIFY=false` is set in production.

### Operations migration release gate

The store and admin journals currently share Drizzle's default `__drizzle_migrations` table despite representing separate migration histories. The store journal contains a duplicate timestamp for entries 0006 and 0007; the admin migration 0000 timestamp predates later store entries. Treat the DB journal and live schema as authoritative only after comparing both with their respective checked-in SQL. A live `503 OPERATIONS_UNAVAILABLE` from `/api/v1/operations/registration-status` identifies the missing Operations schema lookup; migration `server/src/database/admin-migrations/0003_late_deadpool.sql` creates `operations_users`/`operations_sessions`, but it also alters existing incident/audit foreign keys and indexes and is not safe to rerun without checking for partial DDL.

Before production migration: stop release automation; take and restore-test a full database backup in staging; inspect `information_schema` and `__drizzle_migrations` over verified TLS; compare all migration effects and preconditions; validate row counts and foreign keys on the restored clone; obtain database-owner approval; then execute one reviewed forward-only plan during a monitored window. Do not run `npm run db:migrate:all` or migration commands against production to “see what happens.” Do not mark the migration as applied manually, and do not delete/recreate tables. If the tracker/schema diverge, produce an idempotent repair migration after staging review.

### Render production checklist

- Confirm `NODE_ENV=production`, `DATABASE_URL` points to the public MySQL hostname reachable from Render, and `MYSQL_SSL_VERIFY=true`.
- Confirm the provider CA is trusted; add a provider-verified `MYSQL_SSL_CA` PEM if required. Validate the CA chain and hostname match. Never use `MYSQL_SSL_VERIFY=false`.
- Ensure database URLs and secret values are masked in Render logs; do not paste them into incidents or shell history.
- Confirm `/health/live` and `/health/ready` return `200`; readiness only proves `SELECT 1`, not schema completeness.
- Before release, complete the migration backup/staging gate above. After release, verify Operations registration status, create an operator through the approved method, test authenticated dashboard/incidents/audit requests, and confirm unauthenticated calls still return `401 OPERATIONS_UNAUTHENTICATED`.
- Verify safe 503 responses contain request IDs, while Render logs contain matching sanitized diagnostics and no credentials, SQL text, cookies, or stack traces in client responses.

The callback route is `POST /api/v1/orders/mpesa/callback/:token`. With `MPESA_CALLBACK_URL`, set the full URL exactly as shown in the environment example and ensure its token matches `MPESA_CALLBACK_TOKEN`. The app also supports `DARAJA_CALLBACK_BASE_URL` or `APP_URL` as an HTTPS origin and constructs that route. Register the exact URL in the matching Daraja app. The public URL must reach the same service process that owns the pending payment record. Keep the token private; changing it requires registering the new URL in Daraja and restarting the service.

Set `MPESA_TRANSACTION_TYPE` to `CustomerBuyGoodsOnline` only for an approved Buy Goods setup or `CustomerPayBillOnline` only for an approved PayBill shortcode. Production requires `MPESA_ENV=production` and an explicit transaction type; startup rejects sandbox mode and incomplete settings. Set live values only after Safaricom approves the app and supplies matching credentials and merchant details. Register the resulting callback URL in the live Daraja app. Never mix sandbox and production values.

Use `/health/live` for liveness and `/health/ready` to check both MySQL connections. Run Drizzle migrations as an explicit release step after a backup; do not run migrations automatically at API startup. Store database credentials in the hosting secret manager and use dedicated least-privilege database users. The compose file is for local development only.

## Commerce readiness

Deployment scripts and callback routing do not by themselves make the application ready to accept live orders. Production commerce remains blocked until payment callbacks are verified end to end, pending-order stock reservations have a tested cancellation/expiry process, backups and restore are tested, privacy controls and operational administration are reviewed, and production payment behavior has been approved. Avoid accepting live orders or customer delivery data until those gates are complete.
