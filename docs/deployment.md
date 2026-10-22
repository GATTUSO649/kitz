# Deployment

## Build and run

Use `npm ci` to install dependencies, `npm run build:deploy` to build the Vite client and compile the API, and `npm run start:server` to start the compiled API. The frontend output is in `dist`; the API entry point is `server/dist/server.js`. Set `PORT` to the platform-provided port.

The frontend uses relative `/api/...` requests. In production, serve the Vite `dist` directory with SPA fallback to `index.html` and reverse-proxy `/api/*` to the API on the same public origin. This lets the storefront, session cookies, and Daraja callback use one HTTPS host. Set `CLIENT_ORIGIN` to that exact storefront origin. Do not expose the API's internal port directly to the internet.

## Stable Daraja callback

Give the API a stable hostname on a domain you control, terminate TLS at the host or trusted reverse proxy, and forward `/api/v1/orders/mpesa/callback/*` to the API without rewriting the path. Do not use localhost, a temporary tunnel, or an expiring preview hostname for production callbacks.

Set these in the deployment platform's server-side environment/secret manager, never in Vite variables or source control:

```env
NODE_ENV=production
DARAJA_ENV=sandbox
DARAJA_CALLBACK_BASE_URL=https://api.your-domain.example
DARAJA_CALLBACK_TOKEN=<random secret, at least 32 characters>
DARAJA_CONSUMER_KEY=<sandbox key>
DARAJA_CONSUMER_SECRET=<sandbox secret>
DARAJA_PASSKEY=<sandbox passkey>
DARAJA_SHORTCODE=<sandbox shortcode>
CLIENT_ORIGIN=https://your-domain.example
PORT=<platform-provided port>
DATABASE_URL=<TLS-enabled MySQL URL>
ADMIN_DATABASE_URL=<TLS-enabled admin MySQL URL>
# MYSQL_SSL_CA=<optional PEM CA certificate for the MySQL provider>
```

When `NODE_ENV=production`, both MySQL pools require TLS and verify the server certificate. Set `MYSQL_SSL_CA` only when the database provider uses a CA not trusted by the runtime's system certificate store.

The app appends `/api/v1/orders/mpesa/callback/<token>` to `DARAJA_CALLBACK_BASE_URL`. Register that exact generated URL in the matching Daraja app. The public URL must reach the same API process that owns the pending payment record. Keep the token private; changing it requires registering the newly generated callback URL in Daraja and restarting the API.

Start with sandbox credentials and run a full sandbox checkout through callback verification. Only set `DARAJA_ENV=production` after Safaricom has approved the app and supplied the matching live consumer key, consumer secret, passkey, and shortcode/Till. Replace the callback base URL with the permanent production API origin and register the resulting callback URL in the live Daraja app. Never mix sandbox and production values.

Use `/health` for liveness and `/health/ready` to check both MySQL connections. Run Drizzle migrations as an explicit release step after a backup; do not run migrations automatically at API startup. Store database credentials in the hosting secret manager and use dedicated least-privilege database users. The compose file is for local development only.

## Commerce readiness

Deployment scripts and callback routing do not by themselves make the application ready to accept live orders. Production commerce remains blocked until payment callbacks are verified end to end, pending-order stock reservations have a tested cancellation/expiry process, backups and restore are tested, privacy controls and operational administration are reviewed, and production payment behavior has been approved. Avoid accepting live orders or customer delivery data until those gates are complete.
