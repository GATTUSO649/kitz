# Supabase CLI migration workflow

> **Live ledger check (2026-11-05):** The linked project records 11 Supabase migrations through `20261103000010`. The Drizzle tracker intentionally contains only the initial baseline marker because direct Drizzle migration execution is blocked. A remote dry-run reports `20261105000000_enable_public_rls.sql` as pending; it was not applied. The current live schema has 62 tables (not just the 46-table baseline). See [current PostgreSQL status](supabase-postgresql.md).

## Authority and ownership

Supabase CLI is the authoritative remote migration executor. Drizzle remains the application ORM and schema/type source and is used for `db:generate`; normal Drizzle migration execution is blocked by `npm run db:migrate`.

The application does not execute migrations at startup or in deployment automation. Production migration deployment is an explicit release command.

## Prepared migrations

Migrations `20261103000000` through `20261103000010` are byte-for-byte copies of the PostgreSQL Drizzle SQL files under `server/src/database/postgres-drizzle-migrations/`. The pending `20261105000000_enable_public_rls.sql` is an additional reviewed operational migration, not generated Drizzle output.

| Supabase version | Drizzle source | Purpose |
| --- | --- | --- |
| `20261103000000` | `0000_jittery_brother_voodoo.sql` | Verified production baseline |
| `20261103000001` | `0001_mean_karnak.sql` | Applied in verified Supabase ledger |
| `20261103000002` | `0002_lumpy_nemesis.sql` | Applied in verified Supabase ledger |
| `20261103000003` | `0003_dapper_selene.sql` | Applied in verified Supabase ledger |
| `20261103000004` | `0004_useful_sphinx.sql` | Applied in verified Supabase ledger |
| `20261103000005` | `0005_parallel_the_captain.sql` | Applied in verified Supabase ledger |
| `20261103000006` | `0006_numerous_lester.sql` | Applied in verified Supabase ledger |
| `20261103000007` | `0007_remarkable_chat.sql` | Applied in verified Supabase ledger |
| `20261103000008` | `0008_minor_squadron_supreme.sql` | Applied in verified Supabase ledger |
| `20261103000009` | `0009_mysterious_phil_sheldon.sql` | Monitoring RLS and supporting objects |
| `20261103000010` | `0010_sloppy_hannibal_king.sql` | Admin ecosystem, security findings, inventory, refund, and marketing tables |
| `20261105000000` | Additive operational migration | Enable RLS on all current public tables; pending owner review and deployment |

No compatibility edits were made. Drizzle's `--> statement-breakpoint` comments are valid SQL comments and are preserved.

The listed migrations through `0010` are recorded in the linked project's Supabase ledger. The baseline's 46-table shape is historical; migrations `0001` through `0010` add the remaining tables and constraints represented by the current 62-table schema.

## Baseline reconciliation

Migration `0000` is already applied and must not be executed again. Its historical baseline shape was 46 public base tables, 54 foreign keys, and 113 indexes. The current live catalog has 62 public base tables and RLS enabled on all 62; do not compare current object totals to baseline totals as if the additions were drift.

Before reconciliation, link the project and run the read-only verification workflow with verified TLS credentials.

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<user-scoped-access-token>"
npx supabase link --project-ref qpfrobbaqblamgrbhjup
npm run db:supabase:check
```

Do not place the access token or database password in repository files. The database password can be supplied interactively to a remote CLI command when prompted.

Only after baseline object verification and owner approval, mark the baseline as already applied without executing its SQL:

After linking the project, the exact CLI spelling is:

```powershell
npx supabase migration repair --status applied --remote 20261103000000
```

Confirm that the baseline version is the only baseline repair and that `migration list` reports local `0000` as applied.

## Dry-run and deployment approval

Run these read-only or non-mutating checks:

```powershell
npx supabase --version
npx supabase status
npx supabase migration list
npm run db:supabase:dry-run -- --remote
npx supabase migration list --remote
```

After a database owner reviews the migration plan and explicitly approves production deployment, stop release automation and run:

```powershell
npx supabase db push --remote=qpfrobbaqblamgrbhjup
```

If the CLI requires the database password, enter it interactively rather than storing it.

Do not run `db reset`, unreviewed `migration repair`, or `drizzle-kit push`. Do not run `npm run db:migrate`; it is intentionally blocked.

## Post-deployment verification

```powershell
npx supabase migration list --remote
npm run db:supabase:check
npm run db:supabase:register-baseline
npm run typecheck
npm run build
npm run test
```

`npm run db:supabase:register-baseline` is restricted to the existing Drizzle baseline tracker and only runs if the verified baseline is correct. It does not execute or alter migration SQL.

Verify migrations `0001` through `0010` are recorded once, all 62 expected tables remain present, RLS remains enabled, row counts and foreign keys are unchanged except for intended migration effects, and application read/write smoke tests pass. Do not apply the pending RLS migration until a database owner reviews its effects on Supabase Data API, Realtime, and runtime-role grants.

## Future migrations

1. Change Drizzle schema definitions.
2. Run `npm run db:generate`.
3. Review the generated SQL and verify it against schema snapshots.
4. Assign one new timestamped Supabase migration file whose SQL is reviewed from the Drizzle output.
5. Run local and dry-run validation.
6. Obtain release approval before remote push.
7. Do not add execution to application startup or Render deploy hooks.
