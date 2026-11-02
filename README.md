# KitCulture

KitCulture is a React/TypeScript storefront with an Express API and a Drizzle/PostgreSQL runtime. The current implementation is an early foundation, not a production-ready commerce platform.

> **Database migration status:** The active server runtime now uses Supabase PostgreSQL and the 46-table schema has been created. MySQL data has not been imported because the source host was unreachable. The target is empty and is not ready for production traffic. See [Supabase PostgreSQL migration status](./docs/supabase-postgresql.md) before configuring, deploying, or running database commands.

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
- Restricted administrator sign-in and environment-based administrator provisioning; role-protected dashboard, product/category creation, order status updates, customer listing, inventory adjustments/history, delivery zones, payment records, expenses, financial summaries, business settings, and audit logs. Product, category, and delivery-zone update endpoints are available to authorized administrators.
- Persistent Cloudinary-backed product image galleries with validated JPEG/PNG/WebP uploads, alt text, ordering, primary-image selection, and deletion; product creation can upload a kit image in the same flow, and a failed image upload keeps the created product selected for retry. Administrators can manage scheduled homepage slides and the storefront reads published slides and available team collections from the catalogue API.
- Catalogue sale pricing, trending flags, product-image galleries, paginated product responses, and live/liveness/readiness health endpoints.
- Express security headers, restricted development CORS, JSON size limit, request rate limiting, structured request logs, input validation, and generic server errors.
- Route-level lazy loading, a reduced-motion football loader, contextual product skeletons, reusable accessible notifications, and responsive image loading with Cloudinary auto-format/quality variants and dimensioned fallbacks.
- One PostgreSQL database for storefront and administrator data, with separate customer/admin authentication flows and role-protected routes; the original MySQL database is retained as an unmodified source/rollback system.
- Drizzle schema and migration tooling for customers, saved addresses, wishlists, categories, products, variants, inventory movements, carts, order snapshots, support conversations and location pins, payments, delivery zones, expenses, and application settings.

## Important limitations

This remains an early foundation and is not ready to process live commerce. Orders remain `pending_payment` until the configured payment provider confirms them; never represent an order as paid based on browser state. The browser bag is only a convenience and is not authoritative for prices or stock. The Daraja STK Push and callback-verification code is implemented, but production credentials, Safaricom merchant approval, and a controlled production reconciliation have not been verified; do not enable live checkout until those gates pass. Customer email verification and password recovery are implemented as secure token-based flows using a configurable outbound provider, but live delivery still requires a valid sender domain, a working provider secret, and approved production environment variables. Delivery maps use customer/admin browser location pins and a keyless Google Maps embed; location access requires browser permission and the courier pin updates only when an administrator shares a new pin. Product image upload requires Cloudinary credentials; without them, the API deliberately returns a configuration error rather than storing files on an ephemeral server disk. Server-side cart persistence/merge, notifications, return requests, detailed fulfillment and delivery assignment, broader customer/role administration, promotion management, and broad integration/e2e/security tests remain incomplete. Database-backed ownership workflows do not yet have automated integration coverage. Financial summaries are initial operational reports, not audited accounting statements.

## Local setup

Prerequisites: Node.js 22 or newer, npm, and access to the configured Supabase PostgreSQL database.

1. Copy `.env.example` to `.env`. Set server-side `DATABASE_URL` to your Supabase PostgreSQL URL and `SUPABASE_CA_CERT_FILE` to the local path of the verified Supabase CA PEM. Never expose either setting through a `VITE_` variable or commit them.
2. Verify secure connectivity with `npm run db:supabase:check`. It performs only `SELECT 1` with certificate verification enabled.
3. The empty 46-table baseline has already been created and registered. Do not rerun MySQL migrations against Supabase. Use `npm run db:generate` for reviewed future PostgreSQL migrations and `npm run db:migrate` only after review.
4. **No MySQL data has been imported.** The source database was unreachable during this work. Do not start production commerce on the empty Supabase database; complete a verified source backup, data import, row-count/relationship checks, and end-to-end testing first.
5. To enable persistent product image uploads, set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in the server environment. Keep the API secret private. Uploads are limited to JPEG, PNG, and WebP files of at most 8 MB.
6. Add transactional email settings before testing customer verification or password reset. Use `EMAIL_PROVIDER=resend`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, and `RESEND_API_KEY` in the server environment. The app treats email as optional unless `EMAIL_VERIFICATION_REQUIRED=true` is set.
7. Start the client and API with `npm run dev:all`. Vite may use port 5174 when 5173 is occupied; development origin checks allow this fallback.
8. Administrator sign-in is at `/admin/login`. The one-time local bootstrap is at `/admin/register` and is available only in development while no administrator exists. Operators may also provision through `npm run admin:provision` using server-side `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD`; remove the password after provisioning.
9. `/health/live` checks process liveness and `/health/ready` checks database connectivity. The API listens on port 4000 by default.

The database has no seeded products or delivery zones. Add products, categories, and delivery zones from the authorized admin workflow. Checkout requires at least one active delivery zone. Never use manual database edits as an operational production workflow.

## Commands

- `npm run dev` starts Vite.
- `npm run dev:server` starts the API with file watching.
- `npm run dev:all` starts both processes.
- `npm run typecheck` checks client and server TypeScript.
- `npm run build` creates the client production build.
- `npm run build:server` compiles the server.
- `npm run db:supabase:check` validates verified TLS connectivity with a read-only query.
- `npm run db:supabase:create-schema` creates tables only in an empty PostgreSQL `public` schema; `npm run db:supabase:register-baseline` registers the already-applied baseline.
- `npm run db:generate` / `npm run db:migrate` generate/apply PostgreSQL migrations for both schemas.
- `npm run db:mysql:generate` / `npm run db:mysql:migrate` use preserved MySQL schemas for rollback/source operations only. Never point them at Supabase.
- `npm run admin:provision` creates a restricted administrator from operator-supplied environment variables.

## Environment

See `.env.example`. The active runtime requires a PostgreSQL `DATABASE_URL`; the optional `SUPABASE_CA_CERT_FILE` path loads the CA server-side and TLS verification cannot be disabled. Product endpoints return `503` when PostgreSQL is unavailable. `CLIENT_ORIGIN` must match the frontend origin; local development also allows Vite's `localhost:5174` fallback when `localhost:5173` is occupied. Never commit `.env` or production secrets.

## Deployment status

The client and API can be built independently. The server runtime now targets Supabase PostgreSQL, but the live MySQL source data has not been imported and production deployment is not ready. Keep production traffic on its verified source until backups, data reconciliation, payment/auth/order workflow tests, and rollback gates pass. Customer email verification and password reset still require a valid DNS-verified sender domain and working provider secrets.
