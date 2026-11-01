# KitCulture IT Operations Portal

## Scope and trust boundary

The portal is available at `/operations` and has its own login form and API namespace at `/api/v1/operations`. Operations users, password hashes, sessions, and audit records are stored in dedicated tables; sessions use the separate HTTP-only `kc_ops_session` cookie scoped to `/api/v1/operations`. Store-admin credentials and cookies do not authenticate operations requests, and store-admin accounts do not receive operations access automatically. There is no default operator, no fallback to `/admin/login`, and no shared identity table.

Manage independent operations accounts with `npm run operations:user -- <create|disable|enable|reset-password>`. Set `OPERATIONS_EMAIL` for all actions; `create` also requires `OPERATIONS_NAME` and `OPERATIONS_PASSWORD`, while `reset-password` requires `OPERATIONS_PASSWORD`. The password must satisfy the current 14-character policy and bcrypt byte limit. `disable` and `reset-password` revoke all current operations sessions; `enable` reactivates a disabled account. The CLI writes a provisioning audit event and does not create or modify any store-admin account. These variables are only used by the one-shot CLI, not stored as application runtime secrets.

Optional self-signup is available only when the API environment has `OPERATIONS_SIGNUP_SECRET` set to a random value of at least 32 characters. Enter that value in the IT signup form's **IT secret key** field. The key is never sent to the frontend except when an operator submits the form, and it is compared server-side. Unset the variable after the intended signup window closes; use the CLI for additional accounts.

## Data currently collected

- Process health, uptime, Node.js version, RSS memory, and heap usage from the running process.
- Store and administrator database connectivity and a lightweight `SELECT 1` latency probe.
- HTTP request totals, error totals, average and p95 response duration, and the busiest route templates over the last hour.
- Manually created incidents, severity/status updates, assignments to active operations users, root-cause and resolution notes, investigation notes, and append-only incident history.
- Active operations-user roster for incident assignment; disabled accounts are excluded.
- Operations-specific audit events.
- Existing customer conversations remain in the store's support system. The operations console does not authenticate through or navigate into store-admin pages.

Request telemetry is a bounded in-process sample of 5,000 completed requests. It excludes IP addresses, query strings, headers, request bodies, and path parameter values. It resets on process restart and is not shared across instances; it is not a historical or fleet-wide monitoring system. The API refreshes overview data every 30 seconds.

Render, Railway backup verification, Cloudflare, Daraja, and email-provider status show **unknown** because there is no authorized provider telemetry configured. The dashboard does not initiate payments, claim backups succeeded, or infer provider health. There is no AI assistant, automated incident detector, email/Telegram alert dispatcher, or production restart/configuration control in this implementation.

## Safe schema rollout

The operations schema migration has not been applied. The existing storefront and admin Drizzle histories share a default tracking table and have a known timestamp-order mismatch; the repository's deployment guide warns that `db:migrate:all` is unsafe until histories are reconciled. Do not apply admin migrations to the production database until a database owner has backed up the database, inspected the shared migration table and all pending SQL, and established a reviewed release procedure. Validate the final operations user/session/incident schema on a disposable MySQL database first.

After an approved deployment has applied the admin migrations, create an independent operations account using the CLI above. Confirm it can sign in at `/operations`, that the resulting cookie is `kc_ops_session` with the operations-only path, that a store-admin cookie alone receives 401 from `/api/v1/operations/me`, that an operations cookie alone receives 401 from `/api/v1/admin/me`, and that disabling an operations account revokes its sessions. The operations password is not a store-admin password.

## Current operational playbooks

### Customer authentication or session problem

Detection: customer reports failed sign-in, a session-expiry message, or account APIs return 401/503.

Investigate: reproduce with the affected route, check `/health/ready`, inspect sanitized request IDs and auth logs, and verify customer session-table availability. Never request a password or session cookie.

Approved resolution: confirm account email and configured password-recovery delivery; use the existing password-reset flow. Do not edit session tokens or customer passwords directly in SQL.

Verify and recover: confirm a fresh login and session renewal, then ensure logout revokes the session. Escalate repeated failures across customers as P2; an isolated account issue is P3.

### M-PESA initiation, callback, or pending payment

Detection: STK initiation errors, `requires_review`, or a payment pending beyond the expected customer interaction.

Investigate: use the order number and safe provider request IDs; inspect application logs and payment status. Confirm callback token/path configuration and Daraja environment. Query Safaricom using the existing server-side verification workflow.

Approved resolution: do not mark payments paid manually based on a browser return, screenshot, or callback payload alone. Reconcile with Safaricom records and use existing authenticated administrative procedures. Do not replay a real STK request during diagnosis.

Verify and recover: confirm order, amount, payer, receipt, and final provider status agree. Escalate multiple affected payments or inconsistent financial state as P1/P2.

### MySQL unavailable or slow

Detection: `/health/ready` returns 503, database probes fail, or API responses report temporary database unavailability.

Investigate: inspect sanitized database diagnostics and Render/Railway provider status in their authorized dashboards. Check pool errors, TLS verification, connection limits, and recent deploys. Do not copy credentials or raw SQL into incident notes.

Approved resolution: restore connectivity or correct verified TLS/secret configuration through the hosting console. Do not disable TLS verification or run migrations automatically.

Verify and recover: require readiness to return 200 and verify customer catalogue/account reads. Escalate persistent outage as P1.

### Website or API unavailable

Detection: public health checks fail, Render reports unhealthy deploys, or users report widespread errors.

Investigate: compare `/health/live` and `/health/ready`, inspect deployment logs and recent release changes, and use the hosting dashboard to establish platform status.

Approved resolution: use Render's reviewed rollback/redeploy controls. Do not restart or change production environment variables from this portal.

Verify and recover: confirm HTTPS, the public storefront, API, database readiness, customer login, product browsing, and checkout availability. Escalate outage as P1.

### Email delivery failure

Detection: customer verification/recovery messages fail or provider delivery logs show repeated rejection.

Investigate: inspect the email delivery log's safe error category and provider message ID; check sender verification, SMTP/provider status, and secret configuration in the hosting dashboard.

Approved resolution: correct verified provider settings and retry only through the supported email flow. Do not expose recipient lists or provider credentials in incident notes.

Verify and recover: send one controlled test to an authorized mailbox and confirm provider acceptance/delivery evidence. Escalate broad verification/recovery disruption as P2; isolated delay as P3.

## Required follow-up for production-grade monitoring

- Configure authorized Render, Railway, Cloudflare, Safaricom, and email-provider read-only telemetry credentials in a backend secret manager before enabling those integrations.
- Choose durable, shared metrics storage/collection before relying on multi-instance history. Current metrics are per-process and ephemeral.
- Establish alert thresholds, deduplication, notification destinations, retention, on-call ownership, and a tested delivery path before claiming alerts are active.
- Integrate backup evidence only from provider completion records and periodic restore tests.
- Configure operator access only after migration ordering is reconciled and staging-tested.
- AI analysis/actions are intentionally absent; do not add a model-backed tool until data permissions, secret handling, approval gates, audit retention, and provider credentials have been reviewed.
