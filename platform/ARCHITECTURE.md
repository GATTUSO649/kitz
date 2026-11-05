# Independent Platform Architecture

## Protected Kitz Baseline

- Baseline commit: `090007cd0a71f33581c7075f95dfe44bee9e206d`
- Commit timestamp: `2026-11-05T13:50:13+03:00`
- Worktree status before platform work: clean (`git status --porcelain=v1` returned no entries).
- The commit tree is the byte-for-byte Git baseline for all tracked Kitz files. No Kitz source, configuration, migration, or deployment file is authorized for modification.
- All platform work belongs under this `platform/` directory. Root-level manifests and existing application directories remain protected.

## Proposed Deployment Boundary

Deploy the new platform as an independent application on a platform hostname. Its `/` is the shared entry page, and its `/marketplace/*` routes are served by the new marketplace frontend/API. The `/kits` choice redirects to the already-deployed Kitz origin (`https://kitz.onrender.com` unless the operator configures the verified production origin). This is the lowest-risk way to preserve the existing app: its root-based asset paths, client routes, API and cookies continue to run unchanged on their current origin. A same-origin `/kits/*` reverse proxy is not recommended unless a staging proof establishes that prefix rewriting preserves all of those contracts.

The platform has its own frontend entry, router, styles, backend, API namespace, environment configuration, package/build process and deployment manifest. No Kitz modules, auth/session state, admin accounts, payment handlers, or commerce records are shared. Navigation back to the platform landing page is provided within the new app; the Kitz destination remains the existing site.

## Marketplace Data and Integrations

- MarketHub may share the existing Supabase PostgreSQL database only through its dedicated `marketplace` schema, MarketHub-specific connection settings, and a least-privilege database role. Keep all tables, indexes, constraints and migration history in `marketplace`; never replay legacy unqualified migrations or alter objects in `public`. Schema separation is not application-level authorization, so all protected operations remain server-side.
- Keep marketplace publication and contact-unlock payments in a separate Daraja integration module, with distinct payment-purpose values, records, callbacks, references, secrets and audit trail. Live mode stays disabled until merchant approval, credentials, registered callback, reconciliation and a controlled end-to-end verification are complete.
- Store listing images in a dedicated persistent object-storage bucket. Do not write durable uploads to the application filesystem.
- Marketplace administrators use a separate identity/session store and backend-enforced permissions. No Kitz administrator identity or permission is accepted by the marketplace.

## Visual Direction

Treat the supplied three images as the visual specification: the platform entry uses the first screenshot's dark navy/orange identity and two large side-by-side destination panels; marketplace browsing follows the second screenshot's green-led search, category strip, listings and trust/support bands; marketplace administration follows the third screenshot's dense green sidebar and operational dashboard. Use original implementation and independently sourced/licensed imagery rather than embedding the supplied screenshots as page backgrounds. Preserve the existing Kitz visual system by leaving it untouched.

## Routing and Hosting

- Platform origin `/`: shared platform entry.
- Platform origin `/marketplace/*`: independent marketplace site and API.
- Platform origin `/kits`: redirect to the configured existing Kitz origin; no Kitz proxy rewrite.
- Existing Kitz origin: unchanged application, APIs, database, payments and administration.
- Future same-domain paths or subdomain routing may be introduced at an edge proxy only after staging proves compatibility; that deployment change must not require edits inside the protected Kitz repository files.

The new deployment must configure HTTPS, exact CORS/origin policy, health probes, secrets, database connectivity, object storage and Daraja callback routing independently. It must not be represented as production-ready until the external services and operational gates are verified.

## Constraints and Known Risks

The existing production-readiness report (`docs/production-readiness-report-2026-11-05.md`) says the Kitz system is not production-ready: database provenance/migration parity and the runtime role's `BYPASSRLS` status need owner review; live Daraja, email, Cloudinary and restore procedures are unverified. Marketplace work does not resolve or modify those Kitz issues. No live database, secret, or payment operation is authorized by this architecture.

## Change-Control Verification

Before and after platform edits, inspect `git status --short` and `git diff --name-only <baseline>`. The only permitted changed path is `platform/**`; any tracked path outside it is a stop condition. The baseline commit itself records the full tracked file contents, and the initially clean worktree proves there were no pre-existing local Kitz edits to conflate with platform work.
