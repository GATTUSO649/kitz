# KitCulture administration ecosystem implementation plan

## Phase 1 architecture assessment

### Existing architecture

- Frontend: React 19, TypeScript, Vite, Tailwind utilities, React Query, existing Operations/Admin pages.
- Backend: Node.js, Express, TypeScript, Zod, bcrypt, PostgreSQL via Drizzle ORM.
- Store database: `DATABASE_URL`; administrative database: `ADMIN_DATABASE_URL`, with fallback behavior.
- Existing administrator identity: `admin_users`.
- Existing administrator sessions: `admin_sessions`, with opaque tokens stored as hashes.
- Existing administrator verification: `admin_verification_tokens`.
- Existing administrator audit: `adminAuditLogs`.
- Existing setup lock: `admin_setup_locks`.
- Existing operations identities and sessions: `operations_users`, `operations_sessions`.
- Existing IT grants: `operations_operators`, linking administrators to IT roles.
- Existing IT permission catalog: `server/src/modules/admin/it-access.ts`.
- Existing admin login: email plus password; `/api/v1/admin/login`.
- Existing admin routes: `/admin` and the existing IT operations environment at `/operations`.
- Existing email transport: Resend when configured; `smtp` is accepted by configuration but not implemented.

### Critical reuse and consolidation decisions

1. Do not create a duplicate `administrators` identity table. Extend `admin_users` only where the ecosystem genuinely lacks fields.
2. Treat `admin_users` as the database identity and separate administrator sessions remain in `admin_sessions`.
3. Treat `operations_operators.adminUserId` as the IT-role grant, but add a centralized administrator role model for Super, Sales, Finance, Inventory, Marketing, and Content portals.
4. Do not continue relying on a separate operations password identity as the primary administrator identity. The Operations portal should authenticate administrators through the existing administrator session where possible, with a compatibility bridge for current operations accounts documented before cutover.
5. Reuse `adminAuditLogs` and `operations_audit_events`; ordinary administrators must not receive mutation access to either log history.
6. Reuse existing verification tokens and extend the schema only for invitation/onboarding state. Do not store raw tokens or expose verification tokens in APIs.
7. Generate role numbers in transactional database locking and store them, never as primary keys.
8. Preserve the existing customer session and customer tables without inheritance of administrator permissions.

### Existing gaps

- No role number column.
- No role or permission columns on `admin_users` beyond external IT grants.
- Sales, finance, inventory, marketing, and content roles are not represented as administrative identities.
- No administrator invitation entity.
- No SMTP transport despite SMTP environment names not being parsed.
- No role-aware `/admin/me` response.
- Existing public admin registration has a shared setup-secret bootstrap and does not create a role-restricted ecosystem.
- Existing frontend portal routing only recognizes `/admin` and `/operations`; dedicated role routes do not exist.
- Existing verification response can expose a local verification URL, which is unsuitable for production email delivery.
- IT permission checks exist for the admin grant table but do not cover the complete role ecosystem.
- Dashboard routes use real application data selectively; financial, super-admin, inventory, marketing, and content analytics must be built against actual existing records.

## Recommended implementation sequence

### Phase 2 - database and authentication design

- Extend `admin_users` with status, role number, role, suspended timestamps, and onboarding state where migration-safe.
- Add administrator roles and permissions tables only if an existing equivalent is not authoritative.
- Add `admin_invitations` and pending activation fields as required.
- Add role number counters keyed by role prefix, or allocate under an advisory transaction lock.
- Add unique constraints for role numbers and invitation/email pairs.
- Prepare one forward-only Supabase migration and Drizzle definitions.
- Add no role routes or production mutations until migration review is approved.

### Phase 3 - super-admin bootstrap

- Add a dedicated `/super-admin/signup` route.
- Require `ADMIN_SECRET_KEY` and enforce one Super Administrator through `admin_setup_locks` plus transaction locking.
- Hash the password with the existing bcrypt policy.
- Do not activate the account until verification succeeds.
- Send verification by the configured email provider.
- Remove or disable public Super Administrator registration after bootstrap.

### Phase 4 - super-admin dashboard and management

- Add live administrator inventory, status, role, sessions, invitations, audit, and login-attempt summaries.
- Add transaction-safe create/suspend/reactivate/reset/revoke-role actions.
- Add server-generated role numbers and preview only after persistence.
- Add role and permission assignment history.

### Phase 5 - onboarding and SMTP

- Add SMTP variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM`, `SMTP_REQUIRE_TLS`, and `APP_BASE_URL`.
- Implement Nodemailer or an equivalent maintained SMTP transport; port 2525 defaults to STARTTLS unless provider configuration explicitly requires implicit TLS.
- Hash invitation and verification tokens before persistence.
- Keep pending administrators inactive until delivery succeeds and verification succeeds.
- Add resend, expiry, invalid-token, replay, and delivery-log handling.

### Phase 6 - centralized administrator login

- Accept role number or verified administrator email initially; keep email compatibility during migration.
- Derive role and permissions from the database session lookup, never from request input.
- Redirect to dedicated paths using the server-confirmed role.

### Phase 7 - RBAC middleware

- Add permission strings for every role and sensitive mutation.
- Add route middleware that authorizes session role and permission.
- Preserve customer isolation from admin cookies and API routers.
- Default to deny, including unknown roles and missing database grants.

### Phase 8 - role portals

- IT: reuse `/operations` as the first complete portal and map the new RBAC model to it.
- Super Admin: use a dedicated `/super-admin` frontend.
- Sales and content can initially reuse existing `/admin` modules where their permissions match.
- Finance, inventory, marketing, and content receive dedicated real-data pages backed by existing orders, payments, stock, catalogue, and notification records.

### Phase 9 - analytics

- Add server-side aggregates, bounded ranges, pagination, and authorized exports.
- No chart is rendered until its query is implemented; unavailable telemetry is explicitly distinct from zero data.

### Phase 10 - hardening

- Centralize audit fields, rate limits, origin validation, session revocation, failed-login tracking, and generic errors.
- Never expose verification/invite tokens, SMTP credentials, password hashes, secret keys, or payment secrets.

### Phase 11/12 - validation and deployment

- Run migration dry-run, staging migration, restoration verification, tests, and complete regression suite before production approval.
- Apply migrations only by explicit owner approval through the established Supabase workflow.
- Production SMTP and `ADMIN_SECRET_KEY` are configuration requirements, not simulated integrations.

## Files reviewed

- `server/src/database/admin-schema.ts`
- `server/src/modules/admin/auth.ts`
- `server/src/modules/admin/routes.ts`
- `server/src/modules/admin/it-access.ts`
- `server/src/modules/operations/routes.ts`
- `server/src/config/email.ts`
- `server/src/config/env.ts`
- `src/App.tsx`
- `src/pages/AdminPages.tsx`
- `src/pages/OperationsPages.tsx`
- Existing Supabase migration history and Drizzle admin migrations.

## Phase 1 classification

Repository inspection and architecture report are complete. No database migration, production mutation, credential configuration, or portal redesign has been performed.
