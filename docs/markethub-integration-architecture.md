# MarketHub Integration Architecture Assessment

Assessment date: 2026-11-06  
Status: Source inspection and scoped implementation completed. This document describes code and test evidence; it does not certify Render configuration, database migrations, or production integrations.

## Current Application Boundaries

### KitCulture / Kitz

- The customer and administrator frontend is the root Vite application. `src/main.tsx` resolves `/admin/access` to the portal registry in `src/pages/AdminAccessPage.tsx`.
- The root Express API runs on port 4000 in development. Administrator authentication and ecosystem operations are mounted under `/api/v1/admin`.
- `server/src/config/database.ts` creates the Kitz PostgreSQL pool from `DATABASE_URL`; both `db` and `adminDb` use that pool. The administrator schema is therefore not a separate database connection in the current runtime.
- `server/src/database/admin-schema.ts` defines the central `admin_users`, session, verification-token, invitation, permission, and audit records. It now includes `second_hand_admin`, `seller_support_admin`, `marketplace_finance_admin`, and `marketplace_moderator` roles with separate Marketplace permissions.
- Kitz Super Admin APIs support invitations, role assignment, permission changes, approval/rejection, account activation/suspension/disablement, session revocation, verification status, and activity history. These operations derive the actor from the administrator session and enforce Super Admin permissions server-side.
- Marketplace invite verification leaves the account pending. Kitz Super Admin approval is required before MarketHub can authenticate the account; rejection is a distinct status and is not reversed by a verification link.
- Production migration and database status are not inferred from source. Kitz migration execution is guarded and must remain an operator-reviewed action.

### MarketHub Platform

- `platform/` is a separate Vite and Express application intended for its own Render service. Its frontend uses port 5173 and its API uses port 4001 in local development.
- The API connects using `MARKETPLACE_DATABASE_URL` and requires the `marketplace` PostgreSQL schema, with independent database host/user/name validation and verified TLS in production. Its Drizzle schema explicitly qualifies marketplace tables under that schema.
- MarketHub retains `marketplace_admin_users` only as a credential-free local identity projection for Marketplace foreign keys, sessions, and audit references. It has a nullable unique `kitz_admin_id` link; local bootstrap, invitation, activation, directory, and status mutations are disabled.
- MarketHub login verifies credentials through a service-token-protected Kitz endpoint, then asks Kitz for current account status and effective permissions on every protected API request. Network/configuration failures fail closed. MarketHub navigation is rendered from the returned permission list; APIs remain the authorization boundary.
- MarketHub sellers retain separate seller-account, seller-session, and seller-verification records and a separate cookie. Password reset uses hashed one-time tokens, a generic account-existence response, session revocation, an audit row, and the MarketHub email outbox.

## Shared-Service Status

### Email

- Kitz `server/src/config/email.ts` implements SMTP through Nodemailer and also supports Resend. Its settings use `EMAIL_PROVIDER`, `SMTP_*`, and `EMAIL_FROM`; delivery events are written to Kitz `email_delivery_logs`.
- MarketHub has application-specific email templates and an outbox in `marketplace.marketplace_email_events`. Production code now requires SMTP/Brevo and rejects disabled/Resend configuration; development/test may still use the existing Resend adapter. The queue retains bounded retry and audited requeue behavior.
- Both services require SMTP in production, but different environment-variable namespaces mean operators must set the same Brevo account values and verified sender on both Render services. Code cannot prove that the configured credential strings are identical. No secret values or sender-domain verification were inspected.

### M-Pesa Daraja

- Kitz payment records and callbacks belong to the Kitz orders/payment flow. Its callback route is `/api/v1/orders/mpesa/callback/:token`; credentials use the `DARAJA_*` names, with `MPESA_*` aliases.
- MarketHub owns `marketplace.marketplace_payments` and idempotent callback records in `marketplace.marketplace_payment_callbacks`. Its callback route is `/api/v1/marketplace/payments/callback/:token`; its credentials use `MARKETPLACE_DARAJA_*` names.
- Each service verifies its own callback token, payment references, amount/phone/provider metadata, and Daraja status before settlement. Both payment records now have an explicit, constrained `application_id` (`KITZ` or `MARKETHUB`); callback handlers reject a mismatched application identifier. Sharing the same Daraja account values remains a Render configuration task, not a verified fact.
- No live credentials, callback registration, settlement account, payment, or reconciliation was inspected or exercised.

## `/admin/access` UI Finding

`AdminAccessPage.tsx` now includes a Second-Hand Admin card that links to the separate `/admin/marketplace/login` route using build-time `VITE_MARKETHUB_ORIGIN`. Seller login and signup retain the fixed background image; a tablet breakpoint prevents the auth panel from covering the brand, and the auth flow includes password visibility and recovery controls.

## Implementation Status

1. **Implemented:** Portal card/configuration, central Kitz Marketplace roles/permissions, invite verification gate, approve/reject audit and email paths, MarketHub service authentication/live authorization, seller password recovery, and explicit app IDs/callback checks.
2. **Generated, not applied:** Kitz Supabase migrations `20261106000000_marketplace_administrator_roles.sql`, `20261106000001_marketplace_admin_approval_state.sql`, and `20261106000002_payment_application_id.sql`; MarketHub schema migration `0005_central_admin_payments_seller_recovery.sql`.
3. **Render configuration required:** Set Kitz `MARKETHUB_SERVICE_TOKEN`, `MARKETHUB_PUBLIC_URL`, `EMAIL_PROVIDER=smtp`, and the approved `SMTP_*`/`EMAIL_FROM` values. Set MarketHub `KITCULTURE_MARKETPLACE_AUTH_URL`, `KITCULTURE_MARKETPLACE_AUTHORIZE_URL`, the same service token, optional origin-auth token, SMTP/Brevo values, and build-time Kitz/MarketHub origins. Keep both Daraja configurations pointed at the existing account values, with separate callbacks.
4. **Still unverified:** No migrations were applied; no existing local Marketplace admin accounts were mapped against production Kitz identities; no Render secrets/domains were inspected; no Brevo email, live Daraja transaction, callback registration, settlement configuration, backup, or restore was tested. Run staging invitation, approval/rejection, suspension, seller reset, email, payment callback, reconciliation, and Kitz regression tests before production rollout.
5. **Known integration boundary:** Approval, role, suspension, and permission changes are enforced through Kitz on the next MarketHub API request. Existing MarketHub local admin rows are preserved, not deleted. A Kitz administrator activity screen does not yet aggregate MarketHub audit rows; MarketHub retains its own activity log.

## Verification Boundaries

Source checks and local tests/typechecks were run. The root Kitz app integration suite passed 31 tests, Kitz Marketplace permission tests passed 15 tests, and MarketHub passed 46 tests. Both apps' full typechecks passed during implementation; production builds have not yet been run in this turn. No production database was connected, no migration was applied, no Render secret was inspected, no email was sent, and no M-Pesa prompt or callback was exercised. `docs/administration-ecosystem-implementation-plan.md` contains historical statements that differ from current source; current decisions should use source plus this assessment.
