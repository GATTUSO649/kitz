import 'dotenv/config'
import { Pool } from 'pg'
import { createAdminMigrationSslOptions, createPostgresSslOptions } from '../src/config/postgres-ssl.mjs'
import { databaseTargetIdentity } from '../src/config/database-target.js'

const adminTables = [
  'admin_users', 'admin_sessions', 'admin_verification_tokens', 'admin_audit_logs',
  'admin_setup_locks', 'admin_permissions', 'admin_role_permissions', 'admin_user_permissions',
  'admin_invitations', 'admin_login_attempts', 'operations_users', 'operations_sessions',
  'operations_operators', 'operations_incidents', 'operations_incident_events', 'operations_audit_events',
  'monitoring_events', 'monitoring_detection_rules', 'monitoring_alerts', 'monitoring_detection_history',
  'monitoring_worker_state', 'security_scans', 'security_scan_modules', 'security_findings',
  'security_finding_events', 'security_scanner_health', 'security_scan_schedules', 'admin_database_migration_runs',
]
const kitzBusinessActorTables = [
  'application_settings', 'notification_campaigns', 'payment_refunds', 'payment_reconciliations',
  'laundry_service_areas', 'laundry_booking_events', 'laundry_payments', 'laundry_payment_events',
  'inventory_purchase_orders', 'inventory_returns', 'marketing_coupons', 'marketing_email_campaigns',
]
const transferCandidates = adminTables.filter((table) => table !== 'admin_database_migration_runs')
const excludedSchemas = ['pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1']

function parseUrl(value, name) {
  if (!value) throw new Error(`${name} is missing.`)
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`${name} must be PostgreSQL.`)
  return url
}

function poolFor(url, ssl, applicationName) {
  return new Pool({
    connectionString: url.toString(),
    max: 1,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 20_000,
    options: '-c default_transaction_read_only=on',
    application_name: applicationName,
    ssl,
  })
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) throw new Error('Invalid diagnostic identifier.')
  return `"${identifier}"`
}

function redactError(error) {
  const message = error instanceof Error ? error.message : 'Database query failed.'
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted-db-url]')
    .replace(/password\s*[=:]\s*[^\s,;]+/gi, 'password=[redacted]')
    .slice(0, 300)
}

function settingChecks() {
  const url = process.env.MARKETPLACE_DATABASE_URL?.trim()
  let parsed = null
  try { parsed = url ? new URL(url) : null } catch { parsed = null }
  let kitzUrl = null
  try { kitzUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null } catch { kitzUrl = null }
  const marketplaceIdentity = url ? databaseTargetIdentity(url) : null
  const kitzIdentity = process.env.DATABASE_URL ? databaseTargetIdentity(process.env.DATABASE_URL) : null
  const adminIdentity = process.env.ADMIN_DATABASE_URL ? databaseTargetIdentity(process.env.ADMIN_DATABASE_URL) : null
  return {
    marketplaceUrlConfigured: Boolean(url),
    marketplaceProjectIdentityRecognized: Boolean(marketplaceIdentity),
    marketplaceHostMatches: Boolean(parsed && process.env.MARKETPLACE_DATABASE_HOST
      && parsed.hostname.toLowerCase() === process.env.MARKETPLACE_DATABASE_HOST.toLowerCase()),
    marketplaceDatabaseMatches: Boolean(parsed && process.env.MARKETPLACE_DATABASE_NAME
      && decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) === process.env.MARKETPLACE_DATABASE_NAME),
    marketplaceRoleMatches: Boolean(parsed && process.env.MARKETPLACE_DATABASE_USER
      && decodeURIComponent(parsed.username) === process.env.MARKETPLACE_DATABASE_USER),
    marketplaceRoleDistinctFromKitz: Boolean(parsed && kitzUrl
      && decodeURIComponent(parsed.username) !== decodeURIComponent(kitzUrl.username)),
    marketplaceSchemaIsMarketplace: process.env.MARKETPLACE_DATABASE_SCHEMA === 'marketplace',
    marketplaceUsesDistinctSupabaseProjectFromKitz: Boolean(marketplaceIdentity && kitzIdentity && marketplaceIdentity !== kitzIdentity),
    marketplaceUsesDistinctSupabaseProjectFromAdmin: Boolean(marketplaceIdentity && adminIdentity && marketplaceIdentity !== adminIdentity),
    adminMigrationUrlConfigured: Boolean(process.env.ADMIN_MIGRATION_DATABASE_URL?.trim()),
    adminMigrationIdentityConfigured: Boolean(process.env.ADMIN_MIGRATION_TARGET_IDENTITY?.trim()),
    adminMigrationApprovalPresent: process.env.ADMIN_MIGRATION_APPROVED === 'YES',
    backupApprovalPresent: process.env.ADMIN_BACKUP_VERIFIED === 'YES',
    stagingApprovalPresent: process.env.ADMIN_STAGING_VERIFIED === 'YES',
  }
}

async function getRelations(client) {
  return (await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS relation_name,
           c.relkind AS relation_kind, c.relrowsecurity AS row_security_enabled,
           c.relforcerowsecurity AS row_security_forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S')
      AND n.nspname <> ALL($1::text[])
      AND n.nspname NOT LIKE 'pg_temp_%'
      AND n.nspname NOT LIKE 'pg_toast%'
    ORDER BY n.nspname, c.relname
  `, [excludedSchemas])).rows
}

async function inspectKitzSource(client) {
  const relations = await getRelations(client)
  const relationNames = new Set(relations.map(({ schema_name, relation_name }) => `${schema_name}.${relation_name}`))
  const tables = []
  for (const table of [...transferCandidates, ...kitzBusinessActorTables]) {
    const present = relationNames.has(`public.${table}`)
    const rowCount = present
      ? Number((await client.query(`SELECT count(*)::text AS count FROM public.${quoteIdentifier(table)}`)).rows[0].count)
      : null
    tables.push({
      table,
      category: transferCandidates.includes(table) ? 'admin_transfer_candidate' : 'kitz_business_or_site_config',
      present,
      rowCount,
    })
  }
  return {
    relations,
    adminRelatedTableInventory: tables,
    operationsUsersLocations: relations.filter(({ relation_name }) => relation_name === 'operations_users'),
  }
}

async function inspectAdmin(client) {
  const schemas = (await client.query(`
    SELECT schema_name FROM information_schema.schemata
    WHERE schema_name <> ALL($1::text[])
    ORDER BY schema_name
  `, [excludedSchemas])).rows.map(({ schema_name }) => schema_name)
  const relations = await getRelations(client)
  const opsLocations = relations.filter(({ relation_name }) => relation_name === 'operations_users')
  const publicRelations = new Set(relations.filter(({ schema_name }) => schema_name === 'public').map(({ relation_name }) => relation_name))
  const missingExpectedTables = adminTables.filter((table) => !publicRelations.has(table))

  const columns = (await client.query(`
    SELECT table_schema, table_name, ordinal_position, column_name, data_type,
           udt_name, is_nullable, column_default, is_identity
    FROM information_schema.columns
    WHERE table_name = ANY($1::text[])
    ORDER BY table_schema, table_name, ordinal_position
  `, [adminTables])).rows
  const constraints = (await client.query(`
    SELECT tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type,
           pg_get_constraintdef(pc.oid, true) AS definition
    FROM information_schema.table_constraints tc
    LEFT JOIN pg_namespace pn ON pn.nspname = tc.constraint_schema
    LEFT JOIN pg_constraint pc ON pc.conname = tc.constraint_name AND pc.connamespace = pn.oid
    WHERE tc.table_name = ANY($1::text[])
    ORDER BY tc.table_schema, tc.table_name, tc.constraint_type, tc.constraint_name
  `, [adminTables])).rows
  const indexes = (await client.query(`
    SELECT schemaname AS schema_name, tablename AS table_name, indexname AS index_name, indexdef AS definition
    FROM pg_indexes WHERE tablename = ANY($1::text[])
    ORDER BY schemaname, tablename, indexname
  `, [adminTables])).rows
  const policies = (await client.query(`
    SELECT schemaname AS schema_name, tablename AS table_name, policyname AS policy_name,
           permissive, roles, cmd
    FROM pg_policies WHERE tablename = ANY($1::text[])
    ORDER BY schemaname, tablename, policyname
  `, [adminTables])).rows
  const triggers = (await client.query(`
    SELECT event_object_schema AS schema_name, event_object_table AS table_name,
           trigger_name, action_timing, event_manipulation
    FROM information_schema.triggers
    WHERE event_object_table = ANY($1::text[])
    ORDER BY event_object_schema, event_object_table, trigger_name
  `, [adminTables])).rows
  const extensions = (await client.query(`
    SELECT extname, extversion FROM pg_extension ORDER BY extname
  `)).rows
  const privileges = (await client.query(`
    SELECT current_user AS current_role,
           has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
           has_schema_privilege(current_user, 'public', 'USAGE') AS public_schema_usage,
           has_schema_privilege(current_user, 'public', 'CREATE') AS public_schema_create
  `)).rows[0]

  const journalExists = (await client.query(`SELECT to_regclass('public.__drizzle_admin_migrations') AS relation`)).rows[0].relation
  let adminJournal = { exists: Boolean(journalExists), rows: [] }
  if (journalExists) {
    const journalColumns = (await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '__drizzle_admin_migrations'
      ORDER BY ordinal_position
    `)).rows.map(({ column_name }) => column_name)
    const selected = ['id', 'hash', 'created_at'].filter((column) => journalColumns.includes(column))
    if (selected.length) {
      adminJournal.rows = (await client.query(`
        SELECT ${selected.map((column) => `"${column}"`).join(', ')}
        FROM public.__drizzle_admin_migrations ORDER BY id
      `)).rows
    }
  }
  const supabaseJournalExists = Boolean((await client.query(`
    SELECT to_regclass('supabase_migrations.schema_migrations') AS relation
  `)).rows[0].relation)

  return {
    schemas,
    relations,
    operationsUsersLocations: opsLocations,
    expectedAdminTables: adminTables,
    missingExpectedPublicTables: missingExpectedTables,
    columns,
    constraints,
    indexes,
    policies,
    triggers,
    extensions,
    privileges,
    adminDrizzleJournal: adminJournal,
    supabaseMigrationLedgerExists: supabaseJournalExists,
  }
}

async function inspectMarketHub(client) {
  const result = await client.query(`
    SELECT current_database() AS database_name,
           current_user AS role_name,
           current_schema() AS current_schema,
           has_schema_privilege(current_user, 'marketplace', 'USAGE') AS marketplace_usage,
           has_schema_privilege(current_user, 'marketplace', 'CREATE') AS marketplace_create,
           has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
           role.rolsuper AS is_superuser,
           role.rolbypassrls AS bypasses_rls
    FROM pg_roles role WHERE role.rolname = current_user
  `)
  const row = result.rows[0]
  return {
    connected: true,
    database: row.database_name,
    role: row.role_name,
    schema: row.current_schema,
    marketplaceUsage: row.marketplace_usage,
    marketplaceCreate: row.marketplace_create,
    publicCreate: row.public_create,
    isSuperuser: row.is_superuser,
    bypassesRls: row.bypasses_rls,
  }
}

async function main() {
  const kitzUrl = parseUrl(process.env.DATABASE_URL?.trim(), 'DATABASE_URL')
  const adminUrl = parseUrl(process.env.ADMIN_DATABASE_URL?.trim(), 'ADMIN_DATABASE_URL')
  const kitzIdentity = databaseTargetIdentity(kitzUrl.toString())
  const adminIdentity = databaseTargetIdentity(adminUrl.toString())
  if (!kitzIdentity || !adminIdentity || kitzIdentity === adminIdentity) {
    throw new Error('Kitz/Admin Supabase project identities are not confidently distinct.')
  }
  const migrationUrl = process.env.ADMIN_MIGRATION_DATABASE_URL?.trim()
    ? parseUrl(process.env.ADMIN_MIGRATION_DATABASE_URL.trim(), 'ADMIN_MIGRATION_DATABASE_URL')
    : null
  if (migrationUrl && databaseTargetIdentity(migrationUrl.toString()) !== adminIdentity) {
    throw new Error('ADMIN_MIGRATION_DATABASE_URL does not identify the Admin Supabase project.')
  }

  const kitz = poolFor(kitzUrl, createPostgresSslOptions({
    caFile: process.env.SUPABASE_CA_CERT_FILE,
    caContents: process.env.SUPABASE_CA_CERT,
  }, { requireCa: true, connectionName: 'Kitz DATABASE_URL', caFileVariable: 'SUPABASE_CA_CERT_FILE', caContentsVariable: 'SUPABASE_CA_CERT' }), 'kitz-read-only-diagnostic')
  const admin = poolFor(adminUrl, createPostgresSslOptions({
    caFile: process.env.ADMIN_SUPABASE_CA_CERT_FILE,
    caContents: process.env.ADMIN_SUPABASE_CA_CERT,
  }, { requireCa: true, connectionName: 'Admin ADMIN_DATABASE_URL', caFileVariable: 'ADMIN_SUPABASE_CA_CERT_FILE', caContentsVariable: 'ADMIN_SUPABASE_CA_CERT' }), 'admin-read-only-diagnostic')
  const migration = migrationUrl
    ? poolFor(migrationUrl, createAdminMigrationSslOptions({
      migrationUrl: migrationUrl.toString(),
      runtimeAdminUrl: adminUrl.toString(),
      migrationCaFile: process.env.ADMIN_MIGRATION_SUPABASE_CA_CERT_FILE,
      migrationCaContents: process.env.ADMIN_MIGRATION_SUPABASE_CA_CERT,
      adminCaFile: process.env.ADMIN_SUPABASE_CA_CERT_FILE,
      adminCaContents: process.env.ADMIN_SUPABASE_CA_CERT,
      requireCa: true,
    }), 'admin-migration-read-only-diagnostic')
    : null
  const marketplaceUrl = parseUrl(process.env.MARKETPLACE_DATABASE_URL?.trim(), 'MARKETPLACE_DATABASE_URL')
  const marketplace = poolFor(marketplaceUrl, createPostgresSslOptions({
    caFile: process.env.MARKETPLACE_DATABASE_CA_FILE,
    caContents: process.env.MARKETPLACE_DATABASE_CA,
  }, { requireCa: true, connectionName: 'MarketHub MARKETPLACE_DATABASE_URL', caFileVariable: 'MARKETPLACE_DATABASE_CA_FILE', caContentsVariable: 'MARKETPLACE_DATABASE_CA' }), 'marketplace-read-only-diagnostic')

  try {
    const [kitzInfo, adminInfo, marketplaceInfo, migrationInfo] = await Promise.all([
      kitz.query('SELECT current_database() AS database_name, current_schema() AS current_schema'),
      admin.query('SELECT current_database() AS database_name, current_schema() AS current_schema'),
      marketplace.query('SELECT current_database() AS database_name, current_schema() AS current_schema'),
      migration
        ? migration.query(`
          SELECT current_database() AS database_name,
                 current_user AS role_name,
                 current_schema() AS current_schema,
                 has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
                 has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
                 has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
                 role.rolsuper AS is_superuser,
                 role.rolbypassrls AS bypasses_rls
          FROM pg_roles role WHERE role.rolname = current_user
        `)
        : Promise.resolve({ rows: [] }),
    ])
    const [kitzReport, adminReport, marketplaceReport] = await Promise.all([
      inspectKitzSource(kitz),
      inspectAdmin(admin),
      inspectMarketHub(marketplace),
    ])
    console.info(JSON.stringify({
      readOnly: true,
      kitz: { projectIdentity: kitzIdentity, connected: true, database: kitzInfo.rows[0].database_name, ...kitzReport },
      admin: { projectIdentity: adminIdentity, connected: true, database: adminInfo.rows[0].database_name, ...adminReport },
      adminMigration: migration ? {
        projectIdentity: databaseTargetIdentity(migrationUrl.toString()),
        connected: true,
        database: migrationInfo.rows[0]?.database_name,
        role: migrationInfo.rows[0]?.role_name,
        currentSchema: migrationInfo.rows[0]?.current_schema,
        canConnect: migrationInfo.rows[0]?.can_connect,
        publicUsage: migrationInfo.rows[0]?.public_usage,
        publicCreate: migrationInfo.rows[0]?.public_create,
        isSuperuser: migrationInfo.rows[0]?.is_superuser,
        bypassesRls: migrationInfo.rows[0]?.bypasses_rls,
      } : { configured: false },
      marketplace: { projectIdentity: databaseTargetIdentity(marketplaceUrl.toString()), database: marketplaceInfo.rows[0].database_name, ...marketplaceReport },
      marketHubConfigurationChecks: settingChecks(),
      migrationSafetyGates: {
        adminMigrationUrlPresent: Boolean(process.env.ADMIN_MIGRATION_DATABASE_URL?.trim()),
        adminTargetIdentityPresent: Boolean(process.env.ADMIN_MIGRATION_TARGET_IDENTITY?.trim()),
        adminMigrationIdentityMatches: Boolean(migrationUrl
          && databaseTargetIdentity(migrationUrl.toString()) === adminIdentity
          && process.env.ADMIN_MIGRATION_TARGET_IDENTITY === `supabase:${adminIdentity.split(':')[1]}`),
        migrationApproved: process.env.ADMIN_MIGRATION_APPROVED === 'YES',
        backupVerified: process.env.ADMIN_BACKUP_VERIFIED === 'YES',
        stagingVerified: process.env.ADMIN_STAGING_VERIFIED === 'YES',
      },
    }))
  } catch (error) {
    console.error(JSON.stringify({ readOnly: true, error: redactError(error) }))
    process.exitCode = 1
  } finally {
    await Promise.all([kitz.end(), admin.end(), marketplace.end(), migration?.end() ?? Promise.resolve()])
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Admin read-only diagnostics failed.')
  process.exitCode = 1
})
