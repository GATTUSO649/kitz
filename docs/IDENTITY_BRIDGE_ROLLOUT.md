# Identity Bridge Rollout

**Production rollout is not approved or executed by this document.** The bridge is implemented in code but must remain unverified until staging and production gates below are completed by authorized owners.

## Pre-deployment gates

- Record the current production release and obtain current remote Supabase migration ledger/catalog output over verified TLS. Reconcile the whole local migration stream; do not rely on the historical 2026-11-05 ledger report.
- Verify a current production backup and complete an isolated restore rehearsal. Confirm the staging project and credentials are separate from production.
- Confirm the staging PostgreSQL version, schema ownership/permissions, and application compatibility.
- Prepare reviewed Supabase migration copies for 0013 and 0014 in dependency order. The repository currently has no Supabase CLI migration files for these two Drizzle SQL files. Inspect the complete dry-run pending set and checksums; stop if other unexpected migrations are pending.
- Apply 0013 then 0014 in isolated staging only. Verify schema, old row counts, existing administrator records, existing legacy Operations account password login, indexes, constraints and FKs.
- Pass database-backed tests for successful exchange, all specified denied cases, rotation/expiry/revocation, identity collisions, legacy protections, and audit attribution. No current staging evidence exists.
- Verify shared Redis counters and failure behavior with two app instances. `REDIS_URL` is mandatory in production; do not deploy with a process-local fallback.
- Have the central IT super-admin owner verify the exact administrator grant and least-privilege role. Keep CSO grants explicit and do not assign any grant automatically.
- Approve maintenance window, deployment artifact, migration ordering, monitoring owners, and bridge shutdown/application rollback procedure. Written production migration authorization is required.
- Keep `OPERATIONS_IDENTITY_BRIDGE_ENABLED=false` throughout migration and schema verification. Enable it only in a separate approved application release after successful staging checks and explicit grant review.

## Staging procedure

1. Provision/restore a dedicated isolated PostgreSQL staging project using staging credentials; verify host/project identity is not production.
2. Record `SELECT version()` and read-only schema owner/privilege/catalog evidence. Capture the Supabase migration ledger and full dry-run plan.
3. Review exact SQL hashes and verify the SQL copies match the approved 0013/0014 source content. Resolve every migration pending before and after the target migrations.
4. Apply the approved staging set once. Verify the resulting schema and preserved row counts, then run all database-backed identity, authorization, legacy-account, audit, and Redis multi-instance tests.
5. Record test output, sanitized catalog evidence, migration ledger, backup/restore ID, and reviewer approvals. A failed or partial migration blocks production.

## Production deployment, only after explicit authorization

1. Freeze concurrent deployment/migration activity and re-verify the production project identifier, migration ledger, backup ID, and exact pending set.
2. Apply the approved migration versions in order through the existing Supabase CLI release workflow. Do not use Drizzle migration execution, application startup, an Operations route, or an unreviewed migration repair.
3. Verify the migration ledger and schema before deploying compatible application code. If verification fails, stop and follow the rollback/forward-recovery document.
4. Deploy the application with `OPERATIONS_IDENTITY_BRIDGE_ENABLED=false` after successful schema verification. Migrations alone do not grant access or activate exchange.
5. An authorized central IT super-admin explicitly grants the named verified administrator role using `/admin/it/access`. Do not bootstrap or auto-grant the CSO role.
6. In a separate approved activation change, set `OPERATIONS_IDENTITY_BRIDGE_ENABLED=true`; then verify one permitted exchange and one denied account, previous-session invalidation, logout, source-session revocation, audit attribution, legacy login, and Redis-backed limits. Monitor 401/403/429 counts, database errors, and authentication failures.

## Post-deployment evidence

Record timestamps, release/migration versions, migration verification, successful/denied test identities by non-sensitive internal IDs, audit event references, session revocation result, Redis multi-instance result, legacy account result, and monitoring owner. Never copy passwords, cookie contents, Redis URLs, credentials, or signing secrets into the report.

Until these gates pass, statuses remain: local code checks passed; staging not verified; production not verified.