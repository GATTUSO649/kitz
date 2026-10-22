# Deployment

## Build and run

Use `npm ci` to install dependencies, `npm run build:deploy` to build the Vite client and compile the API, and `npm run start:server` to start the compiled server. The frontend output is in `dist`; the API entry point is `server/dist/server.js`. When `dist/index.html` exists, the server serves the frontend, generated assets, and client-side routes alongside the API on the same origin. Set `NODE_ENV=production` for secure cookies and verified MySQL TLS, and use the platform-provided `PORT`.

The frontend uses relative `/api/...` requests. Keeping the storefront and API on the same public origin lets session cookies and the Daraja callback use one HTTPS host. Set `CLIENT_ORIGIN` to that exact storefront origin. Do not expose the API's internal port directly to the internet.

## Render

Create one Node web service from the repository root. Use build command `npm ci && npm run build:deploy`, start command `npm run start:server`, and health check path `/health`. Set `NODE_ENV=production`; Render supplies `PORT` automatically. The database URLs must point to TLS-enabled MySQL databases; this app does not use Render's PostgreSQL databases.

Set `CLIENT_ORIGIN` and `DARAJA_CALLBACK_BASE_URL` to the service's public HTTPS origin (for example, `https://your-service.onrender.com`). Keep the storefront and API on that same origin. Add database and payment credentials as Render environment variables, never as `VITE_` variables or committed files. `MYSQL_SSL_CA` is only needed for a database provider whose CA is not trusted by Node.js.

For Railway, map its MySQL connection URL to `DATABASE_URL` and provide `ADMIN_DATABASE_URL` for the admin schema. After confirming these variables are available in the linked Railway environment and taking a database backup, run `railway run npm run db:migrate:all` from the repository root. The admin migration first creates the database named in `ADMIN_DATABASE_URL`, so its database user must have permission to create databases; otherwise create that database through Railway and adjust the setup flow before running migrations. The migration command is explicit and should not be configured as an automatic app-start command.

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
DATABASE_URL=<TLS-enabled MySQL URL>
ADMIN_DATABASE_URL=<TLS-enabled admin MySQL URL>
LOG_LEVEL=info
# MYSQL_SSL_CA=<optional PEM CA certificate for the MySQL provider>
# CLOUDINARY_CLOUD_NAME=<optional>
# CLOUDINARY_API_KEY=<optional>
# CLOUDINARY_API_SECRET=<optional>
```

`PORT` is supplied by Render; do not hard-code it. To provision the initial administrator, set `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` temporarily when running `npm run admin:provision`, then remove `ADMIN_PASSWORD`. These are not runtime web-service variables.

When `NODE_ENV=production`, both MySQL pools require TLS and verify the server certificate. Set `MYSQL_SSL_CA` only when the database provider uses a CA not trusted by the runtime's system certificate store.

The app appends `/api/v1/orders/mpesa/callback/<token>` to `DARAJA_CALLBACK_BASE_URL`. Register that exact generated URL in the matching Daraja app. The public URL must reach the same service process that owns the pending payment record. Keep the token private; changing it requires registering the newly generated callback URL in Daraja and restarting the service.

Start with sandbox credentials and run a full sandbox checkout through callback verification. Only set `DARAJA_ENV=production` after Safaricom has approved the app and supplied the matching live consumer key, consumer secret, passkey, and shortcode/Till. Replace the callback base URL with the permanent production site origin and register the resulting callback URL in the live Daraja app. Never mix sandbox and production values.

Use `/health` for liveness and `/health/ready` to check both MySQL connections. Run Drizzle migrations as an explicit release step after a backup; do not run migrations automatically at API startup. Store database credentials in the hosting secret manager and use dedicated least-privilege database users. The compose file is for local development only.

## Commerce readiness

Deployment scripts and callback routing do not by themselves make the application ready to accept live orders. Production commerce remains blocked until payment callbacks are verified end to end, pending-order stock reservations have a tested cancellation/expiry process, backups and restore are tested, privacy controls and operational administration are reviewed, and production payment behavior has been approved. Avoid accepting live orders or customer delivery data until those gates are complete.
