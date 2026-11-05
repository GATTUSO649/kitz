# KitCulture

KitCulture is a React/TypeScript storefront with an Express API and a Drizzle/PostgreSQL runtime. The current implementation is an early foundation, not a production-ready commerce platform.

> **Production status:** The active server runtime uses Supabase PostgreSQL. Read-only verification on 2026-11-05 found 62 public tables, rows in customer/order/payment tables, and 11 applied Supabase migrations. Data provenance and source reconciliation are unverified; do not assume these records are production-imported or demo data, and do not clean them up. See [the production-readiness report](./docs/production-readiness-report-2026-11-05.md) and [Supabase status](./docs/supabase-postgresql.md) before deployment or database operations.

## Implemented

- Responsive branded storefront and reduced-motion-aware, skippable wordmark intro.
- Separate route-based pages for the shop, category/team collections, product details, sign-in, sign-up, cart, checkout, customer orders, and administrator modules.
- Team/category catalogue filters, search, price sorting, stock/size display, item descriptions, and price visibility.
- Customer registration, login, session lookup, and logout endpoints using bcrypt password hashes and opaque HttpOnly cookie sessions.
- Database-backed customer/admin sessions with bounded sliding idle expiration (60 minutes for customers, 15 minutes for administrators), absolute lifetime caps, Secure production cookies, and backend revocation.
- Browser registration/sign-in UI with Zod validation, password confirmation, and explicit email-verification status.
- Product search/category filtering, stock-aware add-to-bag interactions, and a bag persisted in the current browser.
- Authenticated checkout that submits only variant IDs and quantities; the API calculates current item prices and configured delivery fees.
- Transactional pending-order creation with conditional stock reservation, inventory movement entries, immutable product/address snapshots, unique order references, and order ownership checks.
- Server-side Daraja STK Push initiation with production/sandbox endpoint selection, phone normalization, retry-safe ambiguous outcomes, token-protected callbacks, provider query verification, and idempotent payment/order updates. Live processing requires approved Safaricom merchant details and production secrets configured outside the repository.
- Customer order listing/detail endpoints and cancellation of pending orders with stock release.
- Protected customer portal pages for the account overview, order history/details, profile, delivery addresses, password security, and wishlist. Profile, address, and wishlist APIs derive ownership from the authenticated session instead of trusting a customer ID from the browser.
- Authenticated two-way customer/admin support chats with order references, automatically refreshed messages, status management, and GPS location pins.
- Delivery tracking with customer-pinned checkout destinations, admin-shared courier locations, a Google Maps view, and directions links.
- A kit marketplace organized by collection, league, team, season, and jersey type, seeded with the European top-five league/team directory and common kit collections; customers can combine collection and jersey-type filters.
- Saved delivery addresses and wishlists in the customer/store database, including an additive migration and ownership constraints.
- Restricted administrator sign-in and Super Admin-invited role accounts; server-side role and permission checks protect administrator APIs. The controlled CLI provisions an active Sales Admin and writes an audit record. Dashboard, catalogue, order, inventory, finance, marketing, and operations workflows remain subject to their configured permissions.
- Persistent Cloudinary-backed product image galleries with validated JPEG/PNG/WebP uploads, alt text, ordering, primary-image selection, and deletion; product creation can upload a kit image in the same flow, and a failed image upload keeps the created product selected for retry. Administrators can manage scheduled homepage slides and the storefront reads published slides and available team collections from the catalogue API.
- Catalogue sale pricing, trending flags, product-image galleries, paginated product responses, and live/liveness/readiness health endpoints.
- Express security headers, restricted development CORS, JSON size limit, request rate limiting, structured request logs, input validation, and generic server errors.
- Route-level lazy loading, a reduced-motion football loader, contextual product skeletons, reusable accessible notifications, and responsive image loading with Cloudinary auto-format/quality variants and dimensioned fallbacks.
- One PostgreSQL database for storefront and administrator data, with separate customer/admin authentication flows and role-protected routes; the original MySQL database is retained as an unmodified source/rollback system.
- Drizzle schema and migration tooling for customers, saved addresses, wishlists, categories, products, variants, inventory movements, carts, order snapshots, support conversations and location pins, payments, delivery zones, expenses, and application settings.

## Important limitations

This remains not ready to process live commerce. Orders remain `pending_payment` until the configured payment provider confirms them; never represent an order as paid based on browser state. The browser bag is only a convenience and is not authoritative for prices or stock. The Daraja STK Push and callback-verification code is implemented, but production credentials, Safaricom merchant approval, and a controlled production reconciliation have not been verified; do not enable live checkout until those gates pass. Customer email verification and password recovery use secure token-based flows, but email is disabled by default and live delivery has not been verified. Delivery maps use browser location pins; courier assignment and dispatch are not implemented. Product image upload requires Cloudinary credentials; without them, the API returns a configuration error rather than storing files on ephemeral disk. Server-side cart persistence/merge, customer-facing return requests, provider refund execution, delivery assignment, and broad database integration/end-to-end tests remain incomplete. Marketing coupon and email-campaign APIs exist, but the role portal UI does not expose all workflows. Database-backed ownership workflows do not yet have automated integration coverage. Financial summaries are operational reports, not audited accounting statements.

## Local setup

Prerequisites: Node.js 22 or newer, npm, and access to the configured Supabase PostgreSQL database.

1. Copy `.env.example` to `.env`. Set server-side `DATABASE_URL` to your Supabase PostgreSQL URL and `SUPABASE_CA_CERT_FILE` to the local path of the verified Supabase CA PEM. Never expose either setting through a `VITE_` variable or commit them.
2. Verify secure connectivity with `npm run db:supabase:check`. It performs only `SELECT 1` with certificate verification enabled.
3. The live project has an existing Supabase migration ledger and a separate Drizzle baseline marker. Do not rerun schema creation or baseline registration. `npm run db:migrate` is intentionally blocked; use `npm run db:supabase:dry-run -- --remote` for a non-mutating plan review and only deploy after backup, staging verification, and owner approval.
4. The connected PostgreSQL database contains customer and commerce rows, but their provenance and parity with the legacy source are unknown. Do not classify or delete any records automatically. Obtain and restore a verified source backup, reconcile all tables and relationships, and complete end-to-end tests before routing production traffic.
5. To enable persistent product image uploads, set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in the server environment. Keep the API secret private. Uploads are limited to JPEG, PNG, and WebP files of at most 8 MB.
6. Add transactional email settings before testing customer verification or password reset. For Brevo SMTP, use `EMAIL_PROVIDER=smtp`, `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS`, `SMTP_REQUIRE_TLS=true`, `EMAIL_FROM`, and `EMAIL_REPLY_TO`. The sender address must be verified in Brevo. Resend remains supported through `EMAIL_PROVIDER=resend`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, and `RESEND_API_KEY`. The app treats email as optional unless `EMAIL_VERIFICATION_REQUIRED=true` is set.
7. Start the client and API with `npm run dev:all`. Vite may use port 5174 when 5173 is occupied; development origin checks allow this fallback.
8. Sales sign-in is at `/sales-admin/login` (`/admin/login` redirects there). Initialize the single Super Administrator at `/super-admin/signup`; after that, invite role accounts from the Super Admin console. The controlled `npm run admin:provision` command creates a Sales Admin using server-side `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD`. Manage independent Operations users with `npm run operations:user -- <create|disable|enable|reset-password|bootstrap-super-admin>`; the one-time bootstrap requires exact-email approval variables. Remove all one-shot credentials and approval values immediately.
9. `/health/live` checks process liveness and `/health/ready` checks database connectivity. The API listens on port 4000 by default.

The catalogue seed contains reference leagues, teams, collections, and jersey categories, not customer or commerce records. The connected PostgreSQL database currently has product and delivery-zone rows; their provenance is not reconciled. Preserve existing records, and add or change catalogue data only through authorized workflows. Checkout requires at least one active delivery zone. Never use manual database edits as an operational production workflow.

## Commands

- `npm run dev` starts Vite.
- `npm run dev:server` starts the API with file watching.
- `npm run dev:all` starts both processes.
- `npm run typecheck` checks client and server TypeScript.
- `npm run build` creates the client production build.
- `npm run build:server` compiles the server.
- `npm run db:supabase:check` validates verified TLS connectivity with a read-only query.
- `npm run db:supabase:create-schema` creates tables only in an empty PostgreSQL `public` schema; `npm run db:supabase:register-baseline` registers the already-applied baseline.
- `npm run db:generate` generates PostgreSQL migrations for both schemas. `npm run db:migrate` is intentionally disabled; Supabase CLI is the only migration executor.
- `npm run db:supabase:dry-run -- --remote` shows pending linked-project migrations without applying them.
- `npm run db:mysql:generate` / `npm run db:mysql:migrate` use preserved MySQL schemas for rollback/source operations only. Never point them at Supabase.
- `npm run admin:provision` creates a restricted administrator from operator-supplied environment variables.

## Environment

See `.env.example`. The active runtime requires a PostgreSQL `DATABASE_URL`; the optional `SUPABASE_CA_CERT_FILE` path loads the CA server-side and TLS verification cannot be disabled. Product endpoints return `503` when PostgreSQL is unavailable. `CLIENT_ORIGIN` must match the frontend origin; local development also allows Vite's `localhost:5174` fallback when `localhost:5173` is occupied. Never commit `.env` or production secrets.

## Deployment status

The client and API can be built independently. The server runtime now targets Supabase PostgreSQL, but the live MySQL source data has not been imported and production deployment is not ready. Keep production traffic on its verified source until backups, data reconciliation, payment/auth/order workflow tests, and rollback gates pass. Customer email verification and password reset still require a valid DNS-verified sender domain and working provider secrets.
