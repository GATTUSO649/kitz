# Deployment

## Build and run

Use `npm ci` to install dependencies, `npm run build:deploy` to build the Vite client and compile the API, and `npm run start:server` to start the compiled server. The frontend output is in `dist`; the API entry point is `server/dist/server.js`. When `dist/index.html` exists, the server serves the frontend, generated assets, and client-side routes alongside the API on the same origin. Set `NODE_ENV=production` for secure cookies and verified MySQL TLS, and use the platform-provided `PORT`.

The frontend uses relative `/api/...` requests. Keeping the storefront and API on the same public origin lets session cookies and the Daraja callback use one HTTPS host. Set `CLIENT_ORIGIN` to that exact storefront origin. Do not expose the API's internal port directly to the internet.

## Render

Create one Node web service from the repository root. Use build command `npm ci && npm run build:deploy`, start command `npm run start:server`, and health check path `/health`. Set `NODE_ENV=production`; Render supplies `PORT` automatically. The database URLs must point to TLS-enabled MySQL databases; this app does not use Render's PostgreSQL databases.

Set `CLIENT_ORIGIN` and `DARAJA_CALLBACK_BASE_URL` to the service's public HTTPS origin (for example, `https://your-service.onrender.com`). Keep the storefront and API on that same origin. Add database and payment credentials as Render environment variables, never as `VITE_` variables or committed files. If Railway's public MySQL endpoint presents its self-signed CA, set `MYSQL_SSL_CA` in Render to the verified PEM CA certificate from that Railway MySQL service. The application keeps certificate verification enabled; do not work around certificate errors by disabling TLS verification.

Use one Railway MySQL database for storefront and administrator tables. When the app runs on Render, set `DATABASE_URL` to Railway's public TCP connection URL (`MYSQL_PUBLIC_URL`, using its proxy host and port); Railway's private `MYSQL_URL` is only reachable from its private network. The app also accepts `MYSQL_PUBLIC_URL` directly when `DATABASE_URL` is absent and uses the same pool for both feature areas. Do not configure a separate admin database. Back up and inspect the live schema before applying migrations. The current storefront and admin migration histories share Drizzle's default tracking table, and the existing admin migration timestamp predates the latest storefront migration, so `db:migrate:all` is not a safe way to reconcile an existing shared database. Do not run it until the migration histories have been consolidated and the pending SQL has been reviewed. Never run migrations automatically at API startup.

## Stable Daraja callback

Give the service a stable hostname on a domain you control, terminate TLS at Render or a trusted reverse proxy, and keep `/api/v1/orders/mpesa/callback/*` on that same service without rewriting the path. Do not use localhost, a temporary tunnel, or an expiring preview hostname for production callbacks.

Set these in the deployment platform's server-side environment/secret manager, never in Vite variables or source control:

```env
NODE_ENV=production
DARAJA_ENV=sandbox
DARAJA_CALLBACK_BASE_URL=https://your-domain.example
DARAJA_CALLBACK_TOKEN=<random secret, at least 32 characters>
DARAJA_CONSUMER_KEY=<sandbox key>
DARAJA_CONSUMER_SECRET=<sandbox secret>
DARAJA_PASSKEY=<sandbox passkey>
DARAJA_SHORTCODE=<sandbox shortcode>
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

Start with sandbox credentials and run a full sandbox checkout through callback verification. Only set `DARAJA_ENV=production` after Safaricom has approved the app and supplied the matching live consumer key, consumer secret, passkey, and shortcode/Till. Replace the callback base URL with the permanent production site origin and register the resulting callback URL in the live Daraja app. Never mix sandbox and production values.

Use `/health` for liveness and `/health/ready` to check both MySQL connections. Run Drizzle migrations as an explicit release step after a backup; do not run migrations automatically at API startup. Store database credentials in the hosting secret manager and use dedicated least-privilege database users. The compose file is for local development only.

## Commerce readiness

Deployment scripts and callback routing do not by themselves make the application ready to accept live orders. Production commerce remains blocked until payment callbacks are verified end to end, pending-order stock reservations have a tested cancellation/expiry process, backups and restore are tested, privacy controls and operational administration are reviewed, and production payment behavior has been approved. Avoid accepting live orders or customer delivery data until those gates are complete.
