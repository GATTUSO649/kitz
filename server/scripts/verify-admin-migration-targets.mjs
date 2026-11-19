import 'dotenv/config'
import { Pool } from 'pg'
import { createAdminMigrationSslOptions, createPostgresSslOptions } from '../src/config/postgres-ssl.mjs'

function projectIdentity(value, name) {
  if (!value) throw new Error(`${name} is missing.`)
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`${name} must be a PostgreSQL URL.`)
  const direct = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname)?.[1]
  const pooled = /^(?:postgres|supabase_admin)\.([a-z0-9-]+)$/i.exec(decodeURIComponent(url.username))?.[1]
  if (!direct && !pooled) throw new Error(`${name} does not expose a recognizable Supabase project reference.`)
  return { url, projectRef: (direct ?? pooled).toLowerCase() }
}

function createVerifiedPool(target, ssl) {
  return new Pool({
    connectionString: target.url.toString(),
    max: 1,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 15_000,
    options: '-c default_transaction_read_only=on',
    ssl,
  })
}

async function verifyTarget(name, target, ssl, expectedSchema) {
  const pool = createVerifiedPool(target, ssl)
  try {
    const result = await pool.query(`
      SELECT current_database() AS database_name,
            current_user AS role_name,
             current_schema() AS current_schema,
             inet_server_addr()::text AS server_address,
             EXISTS (
               SELECT 1 FROM information_schema.schemata WHERE schema_name = $1
             ) AS expected_schema_exists
    `, [expectedSchema])
    const row = result.rows[0]
    const urlDatabase = decodeURIComponent(target.url.pathname.replace(/^\/+/, ''))
    if (row.database_name !== urlDatabase || !row.expected_schema_exists) {
      throw new Error(`${name} connected to an unexpected database or lacks its expected schema.`)
    }
    return {
      projectRef: target.projectRef,
      connected: true,
      database: row.database_name,
      schema: expectedSchema,
      serverAddress: row.server_address,
    }
  } catch {
    throw new Error(`${name} could not be verified using its configured URL, CA, and read-only database access.`)
  } finally {
    await pool.end()
  }
}

async function main() {
  const requiredNames = ['DATABASE_URL', 'ADMIN_DATABASE_URL', 'MARKETPLACE_DATABASE_URL']
  const missingNames = requiredNames.filter((name) => !process.env[name]?.trim())
  if (missingNames.length) throw new Error(`Database verification settings are missing: ${missingNames.join(', ')}`)

  const kitzTarget = projectIdentity(process.env.DATABASE_URL?.trim(), 'DATABASE_URL')
  const adminTarget = projectIdentity(process.env.ADMIN_DATABASE_URL?.trim(), 'ADMIN_DATABASE_URL')
  const marketplaceTarget = projectIdentity(process.env.MARKETPLACE_DATABASE_URL?.trim(), 'MARKETPLACE_DATABASE_URL')
  const migrationTarget = process.env.ADMIN_MIGRATION_DATABASE_URL?.trim()
    ? projectIdentity(process.env.ADMIN_MIGRATION_DATABASE_URL.trim(), 'ADMIN_MIGRATION_DATABASE_URL')
    : null
  if (kitzTarget.projectRef === adminTarget.projectRef) throw new Error('Kitz and Admin URLs resolve to the same Supabase project.')
  if (marketplaceTarget.projectRef === adminTarget.projectRef) {
    throw new Error('MARKETPLACE_DATABASE_URL resolves to the same Supabase project as ADMIN_DATABASE_URL.')
  }
  const marketplaceHost = marketplaceTarget.url.hostname.toLowerCase()
  const marketplaceDatabase = decodeURIComponent(marketplaceTarget.url.pathname.replace(/^\/+/, ''))
  const marketplaceUser = decodeURIComponent(marketplaceTarget.url.username)
  const kitzUser = decodeURIComponent(kitzTarget.url.username)
  if (!process.env.MARKETPLACE_DATABASE_HOST
    || process.env.MARKETPLACE_DATABASE_HOST.toLowerCase() !== marketplaceHost
    || !process.env.MARKETPLACE_DATABASE_NAME
    || process.env.MARKETPLACE_DATABASE_NAME !== marketplaceDatabase
    || !process.env.MARKETPLACE_DATABASE_USER
    || process.env.MARKETPLACE_DATABASE_USER !== marketplaceUser
    || process.env.MARKETPLACE_DATABASE_SCHEMA !== 'marketplace'
    || marketplaceUser === kitzUser) {
    throw new Error('MarketHub must use its configured marketplace schema and a dedicated runtime database role.')
  }
  if (migrationTarget && migrationTarget.projectRef !== adminTarget.projectRef) {
    throw new Error('ADMIN_MIGRATION_DATABASE_URL must resolve to the Admin Supabase project.')
  }

  const [kitz, admin, marketplace, adminMigration] = await Promise.all([
    verifyTarget('Kitz', kitzTarget, createPostgresSslOptions({
      caFile: process.env.SUPABASE_CA_CERT_FILE,
      caContents: process.env.SUPABASE_CA_CERT,
    }, { requireCa: true, connectionName: 'Kitz DATABASE_URL', caFileVariable: 'SUPABASE_CA_CERT_FILE', caContentsVariable: 'SUPABASE_CA_CERT' }), 'public'),
    verifyTarget('Admin', adminTarget, createPostgresSslOptions({
      caFile: process.env.ADMIN_SUPABASE_CA_CERT_FILE,
      caContents: process.env.ADMIN_SUPABASE_CA_CERT,
    }, { requireCa: true, connectionName: 'Admin ADMIN_DATABASE_URL', caFileVariable: 'ADMIN_SUPABASE_CA_CERT_FILE', caContentsVariable: 'ADMIN_SUPABASE_CA_CERT' }), 'public'),
    verifyTarget('MarketHub', marketplaceTarget, createPostgresSslOptions({
      caFile: process.env.MARKETPLACE_DATABASE_CA_FILE,
      caContents: process.env.MARKETPLACE_DATABASE_CA,
    }, { requireCa: true, connectionName: 'MarketHub MARKETPLACE_DATABASE_URL', caFileVariable: 'MARKETPLACE_DATABASE_CA_FILE', caContentsVariable: 'MARKETPLACE_DATABASE_CA' }), 'marketplace'),
    migrationTarget
      ? verifyTarget('Admin migration', migrationTarget, createAdminMigrationSslOptions({
        migrationUrl: process.env.ADMIN_MIGRATION_DATABASE_URL,
        runtimeAdminUrl: process.env.ADMIN_DATABASE_URL,
        migrationCaFile: process.env.ADMIN_MIGRATION_SUPABASE_CA_CERT_FILE,
        migrationCaContents: process.env.ADMIN_MIGRATION_SUPABASE_CA_CERT,
        adminCaFile: process.env.ADMIN_SUPABASE_CA_CERT_FILE,
        adminCaContents: process.env.ADMIN_SUPABASE_CA_CERT,
        requireCa: true,
      }), 'public')
      : Promise.resolve({ configured: false }),
  ])
  console.info(JSON.stringify({ kitz, admin, adminMigration, marketplace, projectsAreIndependent: true }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Database target verification failed.')
  process.exitCode = 1
})
