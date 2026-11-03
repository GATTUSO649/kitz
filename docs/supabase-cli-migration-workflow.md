# Supabase CLI migration workflow

## Authority and ownership

Supabase CLI is the authoritative remote migration executor. Drizzle remains the application ORM and schema/type source and is used for `db:generate`; normal Drizzle migration execution is blocked by `npm run db:migrate`.

The application does not execute migrations at startup or in deployment automation. Production migration deployment is an explicit release command.

## Prepared migrations

The files in `supabase/migrations/` are byte-for-byte copies of the PostgreSQL Drizzle SQL files under `server/src/database/postgres-drizzle-migrations/`.

| Supabase version | Drizzle source | Purpose |
| --- | --- | --- |
| `20261103000000` | `0000_jittery_brother_voodoo.sql` | Verified production baseline |
| `20261103000001` | `0001_mean_karnak.sql` | Pending migration 0001 |
| `20261103000002` | `0002_lumpy_nemesis.sql` | Pending migration 0002 |
| `20261103000003` | `0003_dapper_selene.sql` | Pending migration 0003 |
| `20261103000004` | `0004_useful_sphinx.sql` | Pending migration 0004 |
| `20261103000005` | `0005_parallel_the_captain.sql` | Pending migration 0005 |
| `20261103000006` | `0006_numerous_lester.sql` | Pending migration 0006 |
| `20261103000007` | `0007_remarkable_chat.sql` | Pending migration 0007 |
| `20261103000008` | `0008_minor_squadron_supreme.sql` | Pending migration 0008 |

No compatibility edits were made. Drizzle's `--> statement-breakpoint` comments are valid SQL comments and are preserved.

`0009_mysterious_phil_sheldon.sql` is outside this migration set. It was added to the existing uncommitted Drizzle work and is not copied or deployed through Supabase unless the separately approved migration plan explicitly includes it.

## Baseline reconciliation

Migration `0000` is already applied to production and must not be executed again. Existing verification records the following baseline shape: 46 public base tables, 54 foreign keys, 113 indexes, and RLS enabled on all 46 base tables.

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
npm run db:supabase:dry-run
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

Verify migrations `0001` through `0008` are recorded once, monitoring objects remain present, row counts and foreign keys are unchanged except for intended migration effects, and application read/write smoke tests pass.

## Future migrations

1. Change Drizzle schema definitions.
2. Run `npm run db:generate`.
3. Review the generated SQL and verify it against schema snapshots.
4. Assign one new timestamped Supabase migration file whose SQL is reviewed from the Drizzle output.
5. Run local and dry-run validation.
6. Obtain release approval before remote push.
7. Do not add execution to application startup or Render deploy hooks.
