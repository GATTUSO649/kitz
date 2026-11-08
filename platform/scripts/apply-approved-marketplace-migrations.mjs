import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'
import { parseSupabaseMigrationLedger } from './migration-audit.mjs'
import { validateExecutionGate, validateManifest } from './marketplace-migration-manifest.mjs'

const { Client } = pg
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const platformDir = path.resolve(scriptDir, '..')
const repositoryDir = path.resolve(platformDir, '..')
const manifestDefault = path.join(platformDir, 'migrations', 'marketplace-manifest.json')

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function sanitize(value) {
  let result = String(value ?? 'unknown failure')
  for (const [name, secret] of Object.entries(process.env)) {
    if (secret && /URL|TOKEN|PASSWORD|SECRET|API_KEY|CA/i.test(name)) result = result.split(secret).join('[REDACTED]')
  }
  return result.replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED DATABASE URL]').replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
}

async function loadPreflight(reportPath, expected) {
  if (!reportPath) throw new Error('MARKETHUB_PREFLIGHT_REPORT is required.')
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  if (!['passed', 'warning'].includes(report.status) || report.readOnly !== true || report.issues?.length) {
    throw new Error('Latest read-only database preflight did not pass.')
  }
  if (report.target?.databaseName !== expected.databaseName || report.target?.host?.toLowerCase() !== expected.host.toLowerCase()
    || report.target?.schema !== 'marketplace') throw new Error('Preflight target does not match the configured Marketplace database target.')
  if (report.marketplaceSellerTermsColumnExists === false
    && !report.plannedChanges?.addedColumns?.includes('marketplace_seller_accounts.terms_accepted_at')) {
    throw new Error('Seller terms acceptance column is missing and is not covered by the approved migration plan.')
  }
  return report
}

function migrationLedgerVersions(text) {
  return new Set(text.split(/\r?\n/).map((version) => version.trim()).filter(Boolean))
}

async function execute() {
  const manifestPath = path.resolve(argument('--manifest', manifestDefault))
  const ledgerPath = argument('--ledger')
  const errors = validateExecutionGate({
    databaseUrl: process.env.MARKETPLACE_MIGRATION_DATABASE_URL,
    approvalReference: process.env.MARKETHUB_APPROVAL_REFERENCE,
    backupVerified: process.env.BACKUP_RESTORE_VERIFIED,
    backupReference: process.env.BACKUP_RESTORE_REFERENCE,
  })
  const expected = {
    databaseName: process.env.MARKETPLACE_DATABASE_NAME,
    host: process.env.MARKETPLACE_DATABASE_HOST,
    schema: process.env.MARKETPLACE_DATABASE_SCHEMA,
    role: process.env.MARKETPLACE_MIGRATION_DATABASE_USER,
    runtimeRole: process.env.MARKETPLACE_DATABASE_USER,
  }
  for (const [name, value] of Object.entries({
    MARKETPLACE_DATABASE_NAME: expected.databaseName,
    MARKETPLACE_DATABASE_HOST: expected.host,
    MARKETPLACE_DATABASE_SCHEMA: expected.schema,
    MARKETPLACE_MIGRATION_DATABASE_USER: expected.role,
    MARKETPLACE_DATABASE_USER: expected.runtimeRole,
    MARKETPLACE_DATABASE_CA: process.env.MARKETPLACE_DATABASE_CA,
    MARKETPLACE_MIGRATION_LEDGER_FILE: ledgerPath,
    MARKETHUB_PREFLIGHT_REPORT: process.env.MARKETHUB_PREFLIGHT_REPORT,
  })) if (!value) errors.push(`${name} is required.`)
  if (expected.databaseName !== 'postgres') errors.push('MARKETPLACE_DATABASE_NAME must be postgres.')
  if (expected.schema !== 'marketplace') errors.push('MARKETPLACE_DATABASE_SCHEMA must be marketplace.')
  if (expected.role && expected.runtimeRole && expected.role === expected.runtimeRole) errors.push('Migration and runtime database roles must be distinct.')
  if (errors.length) throw Object.assign(new Error(errors.join('\n')), { stage: 'configuration' })

  const preflight = await loadPreflight(process.env.MARKETHUB_PREFLIGHT_REPORT, expected)
  if (preflight.migration?.identity?.role !== expected.role) throw Object.assign(new Error('Preflight migration role does not match the configured migration role.'), { stage: 'preflight' })
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const ledgerText = await readFile(ledgerPath, 'utf8')
  const rows = parseSupabaseMigrationLedger(ledgerText)
  if (!rows.length) throw Object.assign(new Error('Supabase migration ledger output is empty or unparseable.'), { stage: 'ledger' })
  const localIds = [...new Set(rows.map(({ local }) => local).filter(Boolean))]
  const remoteIds = new Set(rows.map(({ remote }) => remote).filter(Boolean))
  const pendingIds = localIds.filter((id) => !remoteIds.has(id))
  const validation = await validateManifest(manifest, { root: repositoryDir, pendingIds })
  if (validation.errors.length) throw Object.assign(new Error(validation.errors.join('\n')), { stage: 'manifest' })
  if (!validation.approvedPending.length) throw Object.assign(new Error('No approved, pending Marketplace migrations are available to execute.'), { stage: 'manifest' })

  const databaseUrl = new URL(process.env.MARKETPLACE_MIGRATION_DATABASE_URL)
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) throw Object.assign(new Error('Migration URL must use PostgreSQL.'), { stage: 'identity' })
  if (decodeURIComponent(databaseUrl.username) !== expected.role || databaseUrl.hostname.toLowerCase() !== expected.host.toLowerCase()
    || decodeURIComponent(databaseUrl.pathname.replace(/^\//, '')) !== expected.databaseName) {
    throw Object.assign(new Error('Migration URL does not match the configured database host, name, or role.'), { stage: 'identity' })
  }
  const config = await readFile(path.join(repositoryDir, 'supabase', 'config.toml'), 'utf8')
  const projectRef = config.match(/^project_id\s*=\s*"([a-z0-9]+)"/mi)?.[1]
  if (!projectRef || (!databaseUrl.hostname.toLowerCase().includes(projectRef) && !databaseUrl.username.includes(projectRef))) {
    throw Object.assign(new Error('Migration URL does not identify the configured Supabase project.'), { stage: 'identity' })
  }
  const ca = process.env.MARKETPLACE_DATABASE_CA.replaceAll('\\n', '\n')
  const client = new Client({ connectionString: databaseUrl.toString(), ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10_000, query_timeout: 60_000 })
  let transactionOpen = false
  let currentMigrationId = null
  try {
    await client.connect()
    const identity = (await client.query(`
      SELECT current_database() AS database_name,
             current_user AS role_name,
             EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'marketplace') AS marketplace_exists,
             has_schema_privilege(current_user, 'marketplace', 'USAGE') AS marketplace_usage,
             has_schema_privilege(current_user, 'marketplace', 'CREATE') AS marketplace_create,
             has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
             EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) AS elevated_role,
             (SELECT count(*)::integer FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
               WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'v', 'm', 'S', 'f')
                 AND (has_table_privilege(current_user, relation.oid, 'SELECT') OR has_table_privilege(current_user, relation.oid, 'INSERT')
                   OR has_table_privilege(current_user, relation.oid, 'UPDATE') OR has_table_privilege(current_user, relation.oid, 'DELETE'))
             ) AS public_relation_privileges,
             (SELECT count(*)::integer FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
               WHERE namespace.nspname = 'public' AND pg_has_role(current_user, relation.relowner, 'USAGE')
             ) AS public_owned_relations
    `)).rows[0]
    if (identity.database_name !== expected.databaseName || identity.role_name !== expected.role || !identity.marketplace_exists
      || !identity.marketplace_usage || !identity.marketplace_create || identity.public_create || identity.elevated_role
      || identity.public_relation_privileges > 0 || identity.public_owned_relations > 0) {
      throw Object.assign(new Error('Connected database identity or migration-role privileges do not satisfy the Marketplace-only policy.'), { stage: 'identity' })
    }
    const ledgerAccess = (await client.query(`
      SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS exists,
             CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN false
                  ELSE has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'SELECT') END AS can_read,
             CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN false
                  ELSE (has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'INSERT')
                    OR has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'UPDATE')
                    OR has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'DELETE')
                    OR has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'TRUNCATE')) END AS can_write
    `)).rows[0]
    if (!ledgerAccess.exists || !ledgerAccess.can_read || ledgerAccess.can_write) {
      throw Object.assign(new Error('Migration role must read, but must not modify, the Supabase migration ledger.'), { stage: 'identity' })
    }
    const ledgerTable = ledgerAccess.exists
    if (ledgerTable) {
      const currentRemoteIds = migrationLedgerVersions((await client.query(`SELECT version::text AS version FROM supabase_migrations.schema_migrations ORDER BY version`)).rows.map(({ version }) => version).join('\n'))
      const alreadyRecorded = validation.approvedPending.filter(({ id }) => currentRemoteIds.has(id))
      if (alreadyRecorded.length) throw Object.assign(new Error(`Migration ledger changed after preflight: ${alreadyRecorded.map(({ id }) => id).join(', ')}.`), { stage: 'ledger' })
    }

    await client.query('BEGIN')
    transactionOpen = true
    await client.query("SET LOCAL search_path TO marketplace, pg_catalog")
    await client.query("SET LOCAL lock_timeout TO '10s'")
    await client.query("SET LOCAL statement_timeout TO '5min'")
    const applied = []
    for (const migration of validation.approvedPending) {
      currentMigrationId = migration.id
      await client.query(migration.sql)
      applied.push(migration.id)
    }
    await client.query('COMMIT')
    transactionOpen = false
    return {
      status: 'passed',
      stage: 'complete',
      target: { projectRef, databaseName: expected.databaseName, host: expected.host, schema: expected.schema, role: expected.role },
      preflightCheckedAt: preflight.checkedAt,
      migrationIds: applied,
      supabaseMigrationLedgerUpdated: false,
      completedAt: new Date().toISOString(),
    }
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {})
    throw Object.assign(new Error(error instanceof Error ? error.message : 'Migration execution failed.'), {
      stage: error?.stage ?? (currentMigrationId ? 'apply' : 'connect-or-verify'),
      migrationId: currentMigrationId,
      code: error?.code,
    })
  } finally {
    await client.end().catch(() => {})
  }
}

async function main() {
  const reportPath = path.resolve(argument('--report', path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'marketplace-migration-execution.json')))
  let report
  try {
    report = await execute()
  } catch (error) {
    report = {
      status: 'blocked',
      stage: error?.stage ?? 'preflight',
      migrationId: error?.migrationId ?? null,
      errorCode: error?.code ?? null,
      error: sanitize(error instanceof Error ? error.message : 'unknown failure'),
      completedAt: new Date().toISOString(),
      supabaseMigrationLedgerUpdated: false,
    }
    process.exitCode = 1
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`MarketHub migration executor could not write its report: ${sanitize(error instanceof Error ? error.message : 'unknown failure')}\n`)
    process.exitCode = 1
  })
}