# Deployment

## Build and run

Use `npm ci` to install dependencies, `npm run build:deploy` to build the Vite client and compile the API, and `npm run start:server` to start the compiled server. The frontend output is in `dist`; the API entry point is `server/dist/server.js`. When `dist/index.html` exists, the server serves the frontend, generated assets, and client-side routes alongside the API on the same origin. Set `NODE_ENV=production` for secure cookies and verified MySQL TLS, and use the platform-provided `PORT`.

The frontend uses relative `/api/...` requests. Keeping the storefront and API on the same public origin lets session cookies and the Daraja callback use one HTTPS host. Set `CLIENT_ORIGIN` to that exact storefront origin. Do not expose the API's internal port directly to the internet.

## Render

Create one Node web service from the repository root. Use build command `npm ci --include=dev && npm run build:deploy`, start command `npm run start:server`, and health check path `/health/ready`. The readiness endpoint returns 503 when MySQL is unavailable so Render does not route traffic to an instance that cannot serve commerce requests. Use `/health/live` for process liveness checks. The explicit `--include=dev` is required because `NODE_ENV=production` otherwise makes npm omit TypeScript, Vite, and other build-time dependencies during `npm ci`. Set `NODE_ENV=production`; Render supplies `PORT` automatically. The database URL must point to TLS-enabled MySQL; this app does not use Render's PostgreSQL databases.

Set `CLIENT_ORIGIN` and `DARAJA_CALLBACK_BASE_URL` to the service's public HTTPS origin (for example, `https://your-service.onrender.com`). Keep the storefront and API on that same origin. Add database and payment credentials as Render environment variables, never as `VITE_` variables or committed files. If Railway's public MySQL endpoint presents its self-signed CA, set `MYSQL_SSL_CA` in Render to a trusted PEM CA certificate. If no trusted CA is available, `MYSQL_SSL_VERIFY=false` is an explicit compatibility option: TLS stays encrypted, but the server certificate is not verified, leaving the connection vulnerable to server impersonation. The secure default is `MYSQL_SSL_VERIFY=true`; prefer a verifiable CA whenever possible.

For live payments, set `NODE_ENV=production`, `DARAJA_ENV=production` (or `MPESA_ENV=production`), and the matching live consumer key, secret, passkey, approved shortcode, and transaction type in Render. Production mode intentionally leaves STK Push unavailable when the environment is set to sandbox. Follow [M-Pesa Daraja Setup](mpesa-setup.md) to select PayBill versus Buy Goods and register the exact callback URL. Local `.env` values are not deployed to Render.

Use one Railway MySQL database for storefront and administrator tables. For a Render-hosted app, set `DATABASE_URL` to Railway's `MYSQL_PUBLIC_URL` (public proxy host and port, database `railway`); never use `localhost` or Railway's private `MYSQL_URL` from Render. The app also accepts `MYSQL_PUBLIC_URL` directly when `DATABASE_URL` is absent and uses the same pool for both feature areas. Set `NODE_ENV=production`, `CLIENT_ORIGIN=https://kitz.onrender.com`, and `LOG_LEVEL=info`; let Render provide `PORT`. Remove stale `ADMIN_DATABASE_URL` values. If TLS verification reports a self-signed certificate, configure `MYSQL_SSL_CA` with the verified Railway CA; do not disable certificate verification. If the app is hosted inside Railway instead, use the database service's private `MYSQL_URL` through Railway's variable reference. Do not configure a separate admin database. Back up and inspect the live schema before applying migrations. The current storefront and admin migration histories share Drizzle's default tracking table, and the existing admin migration timestamp predates the latest storefront migration, so `db:migrate:all` is not a safe way to reconcile an existing shared database. Do not run it until the migration histories have been consolidated and the pending SQL has been reviewed. Never run migrations automatically at API startup.

## Stable Daraja callback

Give the service a stable hostname on a domain you control, terminate TLS at Render or a trusted reverse proxy, and keep `/api/v1/orders/mpesa/callback/*` on that same service without rewriting the path. Do not use localhost, a temporary tunnel, or an expiring preview hostname for production callbacks.

Set these in the deployment platform's server-side environment/secret manager, never in Vite variables or source control:

```env
NODE_ENV=production
DARAJA_ENV=production
DARAJA_CALLBACK_BASE_URL=https://your-domain.example
DARAJA_CALLBACK_TOKEN=<random secret, at least 32 characters>
DARAJA_CONSUMER_KEY=<live consumer key>
DARAJA_CONSUMER_SECRET=<live consumer secret>
DARAJA_PASSKEY=<live passkey>
DARAJA_TRANSACTION_TYPE=CustomerBuyGoodsOnline
DARAJA_SHORTCODE=<Safaricom-approved production shortcode>
MPESA_ACCOUNT_REFERENCE=KitZone
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

When `NODE_ENV=production`, the MySQL pool requires TLS and verifies the server certificate. `MYSQL_SSL_CA` adds the provider CA to the MySQL TLS trust configuration when it is not in Node.js's system certificate store. Verify that CA through Railway before adding it to Render; never copy an unverified peer certificate as a trust anchor.

The app appends `/api/v1/orders/mpesa/callback/<token>` to `DARAJA_CALLBACK_BASE_URL`. Register that exact generated URL in the matching Daraja app. The public URL must reach the same service process that owns the pending payment record. Keep the token private; changing it requires registering the newly generated callback URL in Daraja and restarting the service.

Set `DARAJA_TRANSACTION_TYPE` to `CustomerBuyGoodsOnline` only for an approved Buy Goods setup or `CustomerPayBillOnline` only for an approved PayBill shortcode. Production requires both `DARAJA_ENV` and `DARAJA_TRANSACTION_TYPE` explicitly and rejects sandbox mode. Set live values only after Safaricom approves the app and supplies matching credentials and merchant details. Register the resulting callback URL in the live Daraja app. Never mix sandbox and production values.

Use `/health/live` for liveness and `/health/ready` to check both MySQL connections. Run Drizzle migrations as an explicit release step after a backup; do not run migrations automatically at API startup. Store database credentials in the hosting secret manager and use dedicated least-privilege database users. The compose file is for local development only.

## Commerce readiness

Deployment scripts and callback routing do not by themselves make the application ready to accept live orders. Production commerce remains blocked until payment callbacks are verified end to end, pending-order stock reservations have a tested cancellation/expiry process, backups and restore are tested, privacy controls and operational administration are reviewed, and production payment behavior has been approved. Avoid accepting live orders or customer delivery data until those gates are complete.
