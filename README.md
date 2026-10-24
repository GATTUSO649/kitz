# KitCulture

KitCulture is a React/TypeScript storefront with an Express API and a Drizzle/MySQL data layer. The current implementation is an early foundation, not a production-ready commerce platform.

## Implemented

- Responsive branded storefront and reduced-motion-aware, skippable wordmark intro.
- Separate route-based pages for the shop, category/team collections, product details, sign-in, sign-up, cart, checkout, customer orders, and administrator modules.
- Team/category catalogue filters, search, price sorting, stock/size display, item descriptions, and price visibility.
- Customer registration, login, session lookup, and logout endpoints using bcrypt password hashes and opaque HttpOnly cookie sessions.
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
- One MySQL database for storefront and administrator data, with separate customer/admin authentication flows and role-protected routes.
- Drizzle schema and migration tooling for customers, saved addresses, wishlists, categories, products, variants, inventory movements, carts, order snapshots, support conversations and location pins, payments, delivery zones, expenses, and application settings.

## Important limitations

This remains an early foundation and is not ready to process live commerce. Orders remain `pending_payment` until the configured payment provider confirms them; never represent an order as paid based on browser state. The browser bag is only a convenience and is not authoritative for prices or stock. The Daraja STK Push and callback-verification code is implemented, but production credentials, Safaricom merchant approval, and a controlled production reconciliation have not been verified; do not enable live checkout until those gates pass. An automated courier GPS feed and transactional email are not configured integrations. Delivery maps use customer/admin browser location pins and a keyless Google Maps embed; location access requires browser permission and the courier pin updates only when an administrator shares a new pin. Product image upload requires Cloudinary credentials; without them, the API deliberately returns a configuration error rather than storing files on an ephemeral server disk. Customer email verification and password recovery are not implemented; new customer accounts can currently sign in without email verification. Server-side cart persistence/merge, notifications, return requests, detailed fulfillment and delivery assignment, broader customer/role administration, promotion management, and broad integration/e2e/security tests remain incomplete. Database-backed ownership workflows do not yet have automated integration coverage. Financial summaries are initial operational reports, not audited accounting statements.

## Local setup

Prerequisites: Node.js 22 or newer, npm, and MySQL 8 (installed locally or otherwise reachable from this computer).

### MySQL Workbench on this computer

The supplied Workbench connection values are: connection name `shop`, connection method `mysql`/TCP, host `localhost`, port `3306`, and username `root`. Enter the MySQL root password in Workbench itself; it is not included in the screenshot and should not be shared in chat or committed to the repository.

1. Create or open that Workbench connection, enter its root password, and use **Test Connection**. The default schema may be left blank until the next step.
2. Open a Workbench SQL tab and run [`server/src/database/local-workbench-setup.sql`](./server/src/database/local-workbench-setup.sql). It creates the single `kitculture` database for storefront and administrator data, without dropping or changing any existing schema.
3. In the project root, copy `.env.example` to `.env`. Set `DATABASE_URL` to `mysql://root:<URL-encoded-root-password>@localhost:3306/kitculture`. Replace the password with your local MySQL password URL-encoded (for a no-password local root account, use `mysql://root@localhost:3306/kitculture`); keep `.env` local and uncommitted. The app reads this URL when the API starts.
4. To enable persistent product image uploads, set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in `.env`. Keep the API secret private. Uploads are limited to JPEG, PNG, and WebP files of at most 8 MB.
5. Install packages if needed with `npm install`, then generate and review any pending storefront migration with `npm run db:generate`; apply it with `npm run db:migrate`. Administrator tables use the same database. Do not run `npm run db:migrate:admin` or `npm run db:migrate:all` against an existing shared database until the separate migration histories have been consolidated and reviewed.
6. Start the client and API with `npm run dev:all`, or restart them if already running. If Vite reports that port 5173 is occupied, it may start on port 5174; development origin checks allow this fallback.
7. Open `http://localhost:5173/admin/register` to create the first administrator. This one-time bootstrap is available only in local development and only while no administrator exists in `kitculture`. After account creation, follow the verification link shown in the browser; email delivery is not configured. Successful verification redirects to `/admin/login`.
8. Alternatively, operators can provision an administrator through a controlled shell by setting `ADMIN_EMAIL`, `ADMIN_NAME`, and a unique `ADMIN_PASSWORD` of 14–128 characters and running `npm run admin:provision`. The provisioner refuses to promote an existing customer account and marks the operator-provisioned email verified. Remove the password from the environment after provisioning.
9. Open the frontend URL printed by Vite (normally `http://localhost:5173`, or `http://localhost:5174` when the default port is occupied); administrator sign-in is at `/admin/login`. The API listens on `http://localhost:4000`. `/health/live` checks that the API process is responsive; `/health/ready` checks database connectivity. `/health` reports whether the shared database connection is configured and reachable.

Using the Workbench `root` account from the application is intended only for isolated local testing. For shared or deployed environments, create a dedicated MySQL application account scoped to the `kitculture` schema and store its credentials in the deployment secret manager instead.

After changing the storefront Drizzle schema, generate and review a migration with `npm run db:generate`, then apply it with `npm run db:migrate`. Migration `0003_tricky_morlun.sql` adds customer delivery addresses and wishlists; `0005_great_vindicator.sql` adds customer support requests; `0006_lean_anita_blake.sql` seeds the European top five leagues and jersey types; `0008_nice_radioactive_man.sql` adds chat messages and shared location pins. Update the season and club lists from **Admin → Leagues & teams** as competitions change. Administrator schema changes must be incorporated into the shared migration history before deployment.

The database has no seeded products or delivery zones. Add products, categories, and delivery zones from the authorized admin workflow. Checkout requires at least one active delivery zone. Never use manual database edits as an operational production workflow.

## Commands

- `npm run dev` starts Vite.
- `npm run dev:server` starts the API with file watching.
- `npm run dev:all` starts both processes.
- `npm run typecheck` checks client and server TypeScript.
- `npm run build` creates the client production build.
- `npm run build:server` compiles the server.
- `npm run db:generate` / `npm run db:migrate` generate/apply customer/store migrations.
- `npm run db:generate:admin` / `npm run db:migrate:admin` are legacy separate-history commands; do not apply them to a shared database until migration histories are consolidated.
- `npm run admin:provision` creates a restricted administrator from operator-supplied environment variables.

## Environment

See `.env.example`. `DATABASE_URL` is optional only for starting the API shell; product endpoints return `503` until MySQL is configured. `CLIENT_ORIGIN` must match the frontend origin; local development also allows Vite's `localhost:5174` fallback when `localhost:5173` is occupied. Never commit `.env` or production secrets.

## Deployment status

The client and API can be built independently, but Production deployment is not ready: administrator tooling, verified payment processing, email, persistent image storage, automated courier GPS/routing, backup/restore automation, monitoring, and provider configuration still need implementation and verification. Do not accept customer payments with this build; pending-order checkout currently stores customer delivery details in MySQL.
