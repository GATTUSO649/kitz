import 'dotenv/config'
import { Pool } from 'pg'
import { createPostgresSslOptions } from '../src/config/postgres-ssl.mjs'

function projectIdentity(value, name) {
  if (!value) throw new Error(`${name} is missing.`)
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`${name} must be a PostgreSQL URL.`)
  const direct = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname)?.[1]
  const pooled = /^(?:postgres|supabase_admin)\.([a-z0-9-]+)$/i.exec(decodeURIComponent(url.username))?.[1]
  if (!direct && !pooled) throw new Error(`${name} does not expose a recognizable Supabase project reference.`)
  return { url, projectRef: (direct ?? pooled).toLowerCase() }
}

function createVerifiedPool(target, caFile, caContents) {
  return new Pool({
    connectionString: target.url.toString(),
    max: 1,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 15_000,
    options: '-c default_transaction_read_only=on',
    ssl: createPostgresSslOptions({ caFile, caContents }, { requireCa: true }),
  })
}

async function verifyTarget(name, target, caFile, caContents, expectedSchema) {
  const pool = createVerifiedPool(target, caFile, caContents)
  try {
    const result = await pool.query(`
      SELECT current_database() AS database_name,
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
  if (kitzTarget.projectRef === adminTarget.projectRef) throw new Error('Kitz and Admin URLs resolve to the same Supabase project.')
  if (marketplaceTarget.projectRef === kitzTarget.projectRef || marketplaceTarget.projectRef === adminTarget.projectRef) {
    throw new Error('MarketHub must resolve to a Supabase project independent of Kitz and Admin.')
  }

  const [kitz, admin, marketplace] = await Promise.all([
    verifyTarget('Kitz', kitzTarget, process.env.SUPABASE_CA_CERT_FILE, process.env.SUPABASE_CA_CERT, 'public'),
    verifyTarget('Admin', adminTarget, process.env.ADMIN_SUPABASE_CA_CERT_FILE, process.env.ADMIN_SUPABASE_CA_CERT, 'public'),
    verifyTarget('MarketHub', marketplaceTarget, process.env.MARKETPLACE_DATABASE_CA_FILE, process.env.MARKETPLACE_DATABASE_CA, 'marketplace'),
  ])
  console.info(JSON.stringify({ kitz, admin, marketplace, projectsAreIndependent: true }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Database target verification failed.')
  process.exitCode = 1
})
