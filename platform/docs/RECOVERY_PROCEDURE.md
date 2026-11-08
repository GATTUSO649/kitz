# MarketHub Recovery Procedure

## Release blocked before migration

1. Stop the release; do not bypass the environment gate or rerun with a different URL.
2. Download the `markethub-preflight-*` or `markethub-release-*` artifact. Inspect the manifest validation, database preflight, and executor JSON reports. Identify the failed stage, commit, target, migration version, and sanitized error.
3. If the failure is Supabase authentication, schema identity, host/database mismatch, pending `public` SQL, missing Marketplace baseline, role permission, RLS/policy drift, or public fingerprint drift, involve the database owner. Do not retry with `postgres`, the runtime role, or a broader connection string.
4. Fix the migration or reconcile migration history through a separately reviewed process. Re-run preflight and review a new artifact before release approval.

## Migration failure or partial application

1. Stop Render deployment. Do not run an automatic compensating/destructive rollback, `db reset`, `migration repair`, `DROP`, or a Drizzle migration command. The executor only aborts its open transaction on failure; it does not reverse committed migrations or write the Supabase ledger.
2. Preserve the release artifact, migration execution report, Supabase CLI read-only ledger output, deployment ID, commit SHA, and timestamps. Do not copy secrets into the incident report.
3. Have the database owner use a verified read-only connection to inspect the Supabase migration ledger, Marketplace catalog, constraints, indexes, policies, and payment/callback row counts. Do not select or export customer rows unless the incident response explicitly requires it.
4. Compare the executor report and exact manifest checksum with the live Marketplace schema before any retry. The Supabase ledger is intentionally not changed by MarketHub automation. Do not set `executionStatus` to `applied` until a reviewer has verified the SQL effects and recorded evidence in a separate manifest change; never repair or mark the Supabase ledger automatically.
5. Prepare a forward-only corrective migration, test it on a restored staging copy, re-run the protected preflight, and obtain owner approval. Preserve payment history, seller contact entitlements, callback references, audit records, and transaction IDs.

## Render deployment or health failure

1. The release workflow deploys only the MarketHub Render service ID and will not touch Kitz. Capture the Render deployment ID and failed health endpoint from the report.
2. If `/health/live` fails, inspect Render startup logs and service configuration. If `/health/ready` or Marketplace endpoints fail, inspect the sanitized database-preflight report and runtime grants.
3. A Render code rollback is permitted only after confirming the prior code is compatible with the already-applied additive database schema. Database migrations are never automatically rolled back.
4. If the schema may be partially applied or the compatibility of the previous release is unknown, keep traffic paused and involve the database owner before changing service versions.
5. Restore database data only through the approved backup/restore procedure and after confirming the restore target. Never restore over production as an automated pipeline response.

## Required recovery readiness

Before a production release, the operator must provide the backup identifier and evidence of a recent restore/recovery rehearsal in the protected release input. The workflow records that reference but cannot independently prove the external backup's quality. The GitHub `markethub-production` environment must independently require authorized reviewers; the typed approval reference is not a substitute. Missing backup evidence or environment approval blocks the release.