# Security status (2026-11-05)

This is a source review and targeted remediation record, not a penetration test or production security certification. See [the production-readiness report](production-readiness-report-2026-11-05.md) for evidence, test results, and remaining gates.

## Controls observed

- Customer, administrator, and Operations credentials use bcrypt. Opaque random session tokens are stored as SHA-256 digests; cookies are HttpOnly, `SameSite=Strict`, and Secure in production. Customer sessions have a 60-minute idle timeout and 30-day absolute lifetime; admin and Operations sessions have 20-minute idle timeouts and 8-hour absolute lifetimes.
- Authentication, account, order, admin, and Operations mutations enforce configured-origin checks. Super Admin ecosystem writes now enforce the same Origin rule. CORS is exact-origin for browser requests; the optional origin-auth header remains disabled unless configured.
- Express uses Helmet/CSP, bounded JSON, global/auth/provider rate limits, generic production errors, and structured redacted logs. Drizzle parameterizes query values.
- Customer records, addresses, notifications, support messages, and orders are scoped by authenticated ownership in the reviewed handlers. Password reset and administrator role/status changes revoke sessions.
- Administrator business APIs use a default-deny route permission map; role summaries and dashboard fields honor role permissions. Operations endpoints now have a separate default-deny permission map, and there is no HTTP self-bootstrap for an Operations Super Admin.
- M-Pesa callbacks use a secret path token, provider query verification, and order/amount/currency/payer/time matching before transactional settlement. No live payment was initiated during this review.

## Remediation completed

- Removed the first-Operations-user promotion paths from `/permissions` and security actions. One-time Operations Super Admin provisioning now requires explicit CLI approval and exact email matching.
- Added least-privilege checks across Operations routes; unknown routes fail closed. Added finer admin permissions for inventory receiving, PO creation/approval, finance reconciliation, marketing email send, and inventory dashboard access.
- Fixed custom admin permission overrides being ignored when projecting dashboard data, and gated role summaries by the configured dashboard permission.
- Added Origin enforcement to the Super Admin ecosystem router and corrected the misplaced batch-archive route registration.
- Checkout now persists missing optional GPS coordinates as `NULL` and uses the inserted support request ID rather than the notification ID.
- The administrator CLI now creates a usable active Sales Admin with a role number and audit event. The scanner catalog no longer reports `npm-audit` healthy before a scan is run.

## Residual risks

- The connected PostgreSQL runtime role has `BYPASSRLS=true`. RLS is enabled on all 62 observed public tables, but it does not contain a compromise of the runtime role. Replacing the role requires database-owner approval and staging verification; no grants or roles were changed.
- Migration state and data provenance remain unreconciled. The Supabase ledger has 11 applied migrations while the Drizzle bookkeeping table has only its baseline marker. The database contains customer/order/payment rows; these were not inspected individually or classified as production, imported, or test data.
- Production session roles, grants, exposed APIs, WAF/origin reachability, DNS/TLS configuration, secret rotation, backup restoration, email delivery, Cloudinary, and live Daraja behavior were not independently verified.
- Rate limits are process-local and may not coordinate across multiple instances. `trust proxy` is configured for three hops and requires confirmation against the deployed proxy chain.
- Upload checks validate size and file signatures, not decoded dimensions, re-encoding, or malware. Email verification is optional by default. Registration returns a distinct conflict code for an existing email.
- Database-backed ownership, stock contention, refund/reconciliation, and payment callback flows lack comprehensive PostgreSQL integration tests.

Do not treat passing builds or tests as production readiness. Preserve current data, restore-test backups, reconcile migrations and records, and complete authorized staging end-to-end checks before production cutover.
