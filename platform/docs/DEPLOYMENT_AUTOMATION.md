# MarketHub Deployment Automation

## Scope and isolation

The workflows in `.github/workflows/markethub-*.yml` operate only on `platform/` and explicitly named MarketHub migration files. They never invoke a Kitz Render service, install from the repository root, edit Kitz configuration, or deploy a service selected from Kitz settings. Supabase changes are limited to migrations proven to target `marketplace`; a pending `public` migration blocks the release.

The pipeline has three stages:

1. `markethub-ci.yml` runs for Platform changes and MarketHub migration files. It runs TypeScript checks, MarketHub tests, lint, production build, `npm audit`, migration inventory/scope checks, and `git diff --check`.
2. `markethub-preflight.yml` is manually dispatched from `main` for staging or production. It uses a read-only database credential, records database identity, role grants, expected Marketplace tables/columns, the seller-terms column, RLS state, Kitz's public-schema fingerprint, and the remote Supabase ledger. It validates pending root migration IDs against `platform/migrations/marketplace-manifest.json`; it never applies SQL or changes the Supabase ledger. The report is uploaded as `markethub-preflight-<run-id>`.
3. `markethub-release.yml` requires the successful preflight run ID, a verified backup/restore reference, and the protected GitHub environment review. It rechecks the exact commit, target, pending migration plan, manifest checksums, permissions, and public-schema fingerprint. The executor applies only explicitly approved Marketplace files in a single transaction using the dedicated migration role. It never invokes Supabase `db push` and never writes the Supabase migration ledger. Only after post-migration checks pass does the workflow request the configured MarketHub Render service deployment pinned to that exact commit SHA, wait for completion, and check health.

CI and release commands fail closed. A database identity mismatch, Supabase CLI/database authentication failure, public-schema change, out-of-scope pending migration, unsafe changed SQL, missing Marketplace schema object, missing backup confirmation, failed Render deployment, or unhealthy API stops the release. There is no automatic database rollback.

## GitHub environments

Create/configure these repository environments:

| Environment | Use | Protection |
|---|---|---|
| `markethub-development` | CI and release validation only | No deployment credentials |
| `markethub-staging-preflight` | Read-only staging migration inspection | Read-only DB secret only |
| `markethub-production-preflight` | Read-only production migration inspection | Read-only DB secret only; no migration/deploy secret |
| `markethub-staging` | Approved staging migration and Render deployment | Restrict deployment branches to `main` |
| `markethub-production` | Production migration and Render deployment | Require authorized reviewers; restrict deployment branch to `main`; prevent self-review/bypass where repository policy allows |

GitHub environment protection and required reviewers must be configured in repository settings; a workflow file cannot create the reviewer policy itself. Require authorized reviewers on `markethub-production`, restrict deployment branches to `main`, and prevent self-review/bypass where repository policy allows. Release dispatch is restricted to `main` and requires an approval/change reference plus explicit backup/restore evidence. These inputs supplement, and do not replace, the environment reviewer gate.

## GitHub secrets and variables

Set these in the corresponding environments, never in source control:

**Preflight environments**

- Secret `MARKETHUB_PREFLIGHT_DATABASE_URL`: dedicated read-only PostgreSQL URL for the shared Supabase project. It needs catalog/read access and `SELECT` on `supabase_migrations.schema_migrations`, but no DDL or DML grants.
- Variables `MARKETPLACE_DATABASE_NAME=postgres`, `MARKETPLACE_DATABASE_HOST`, `MARKETPLACE_DATABASE_USER`, and `MARKETPLACE_DATABASE_SCHEMA=marketplace`.
- Secret `MARKETPLACE_DATABASE_CA`: verified Supabase CA PEM.

**Staging and production release environments**

- Secret `MARKETPLACE_DATABASE_URL`: MarketHub runtime URL, least-privilege role.
- Secret `MARKETPLACE_MIGRATION_DATABASE_URL`: distinct Marketplace migration role URL. It must not be the runtime role or Supabase `postgres` owner role. Grant required Marketplace DDL and read-only access to the Supabase migration ledger; do not grant writes to `supabase_migrations.schema_migrations` or ownership/access to Kitz `public` objects.
- Secret `MARKETPLACE_DATABASE_CA`: verified Supabase CA PEM.
- Variables `MARKETPLACE_DATABASE_NAME=postgres`, `MARKETPLACE_DATABASE_HOST`, `MARKETPLACE_DATABASE_USER`, `MARKETPLACE_MIGRATION_DATABASE_USER`, and `MARKETPLACE_DATABASE_SCHEMA=marketplace`.
- Secret `RENDER_API_KEY` and variable `RENDER_MARKETHUB_SERVICE_ID` for the MarketHub service only.
- Variable `MARKETHUB_BASE_URL` for the matching staging/production MarketHub origin.
- The automatically provided `GITHUB_TOKEN` is read-only except for artifact operations explicitly granted by the workflow.

Do not configure the Kitz Render service ID or Kitz database credentials in these environments. The MarketHub Supabase URL host is checked against `MARKETPLACE_DATABASE_HOST`; the Supabase database must be `postgres`, and the application schema must be `marketplace`.

## Render runtime variables

The Render MarketHub service must already be configured with the server-side variables documented in [`.env.example`](../.env.example). At minimum, production requires `NODE_ENV=production`, `PLATFORM_ORIGIN`, `MARKETPLACE_DATABASE_URL`, `MARKETPLACE_DATABASE_NAME`, `MARKETPLACE_DATABASE_HOST`, `MARKETPLACE_DATABASE_USER`, `MARKETPLACE_DATABASE_SCHEMA=marketplace`, and `MARKETPLACE_DATABASE_CA`. Configure the relevant Kitz administrator service URLs/token, Brevo SMTP, Cloudinary, and Daraja variables only when those features are enabled. `PORT` is supplied by Render. Never put secrets in `VITE_` variables.

The Render API key used by GitHub Actions must be limited to the required service-management scope. The workflow deploys by the explicit `RENDER_MARKETHUB_SERVICE_ID`, records the Render deployment ID, waits for terminal status, then verifies `/health/live`, `/health/ready`, `/api/v1/marketplace/categories`, and `/api/v1/marketplace/products?limit=1`.

## Reports and failures

Artifacts include migration inventory/plan, manifest validation, database preflight, executor result, post-migration verification, Render status, and a deployment report with commit SHA, workflow run, target, validation/security outcomes, executed IDs, pending ledger IDs, Render deployment ID, and health results. Execution evidence is reported separately from the Supabase ledger, which remains untouched by automation. Error reports contain stage and sanitized errors; database URLs, tokens, CA contents, payment records, and row contents are never included.

The preflight report is a required review input. The release workflow repeats target and plan checks after approval. If any remote authentication step fails or times out, the workflow stops; do not retry using a different database URL or broaden credentials.

## Current release blockers

The current migration audit identifies 25 Marketplace tables in the application schema but no `CREATE TABLE marketplace...` baseline in the root `supabase/migrations/` history. That history also contains Kitz `public` migrations. The manifest is intentionally empty until a database owner reconciles the live schema and ledger and approves specific Marketplace files. Any pending root migration not explicitly listed and verified blocks release. Do not copy or mark historical migrations applied without a verified schema/ledger comparison and owner approval. After an approved execution, a reviewer must reconcile the manifest's `executionStatus` and evidence in a separate reviewed change; automation never marks migrations as applied.

Remote Supabase authentication, Render service configuration, protected-environment reviewers, secrets, and backup/restore readiness were not available to validate in this workspace. The first preflight and release cannot succeed until those repository settings are configured and the migration-history blocker is resolved.