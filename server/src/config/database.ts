import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from './env.js'
import { createPostgresSslOptions } from './postgres-ssl.mjs'
import * as schema from '../database/schema.js'
import * as adminSchema from '../database/admin-schema.js'
import { instrumentPostgresPool } from '../modules/operations/postgres-monitoring.js'
import type { DatabaseMeasurement } from '../modules/operations/postgres-monitoring.js'

let databaseMeasurementRecorder: Promise<typeof import('../modules/operations/database-performance.js')> | null = null

function recordDatabaseMeasurement(measurement: DatabaseMeasurement) {
  databaseMeasurementRecorder ??= import('../modules/operations/database-performance.js')
  void databaseMeasurementRecorder.then(({ recordDatabaseMeasurement: record }) => record(measurement)).catch(() => undefined)
}

export function mysqlSslOptions(nodeEnvironment: string, ca?: string) {
  if (nodeEnvironment !== 'production') return undefined
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
}

export function supabaseSslOptions(caFile?: string, configuredCa?: string, requireCa = false) {
  return createPostgresSslOptions({ caFile, caContents: configuredCa }, { requireCa })
}

const databaseUrl = env.DATABASE_URL
if (databaseUrl && !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
  throw new Error('DATABASE_URL must use the PostgreSQL protocol.')
}
function normalizedConnectionUrl(value: string | undefined, variableName: string): URL | null {
  if (!value) return null
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${variableName} must use the PostgreSQL protocol.`)
  }
  for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key)
  return url
}

const connectionUrl = normalizedConnectionUrl(databaseUrl, 'DATABASE_URL')
const adminConnectionUrl = normalizedConnectionUrl(env.ADMIN_DATABASE_URL, 'ADMIN_DATABASE_URL')

function createPool(
  connectionUrl: URL,
  applicationName: string,
  caConfig: { caFile?: string; caContents?: string } = {
    caFile: env.SUPABASE_CA_CERT_FILE,
    caContents: env.SUPABASE_CA_CERT,
  },
): Pool {
  return new Pool({
      connectionString: connectionUrl.toString(),
      ssl: supabaseSslOptions(caConfig.caFile, caConfig.caContents, env.NODE_ENV === 'production'),
      max: 10,
      connectionTimeoutMillis: 8_000,
      idleTimeoutMillis: 30_000,
      application_name: applicationName,
    })
}

export const pool = connectionUrl ? createPool(connectionUrl, 'kitculture-api') : null

if (pool && process.env.NODE_TEST_CONTEXT === undefined) instrumentPostgresPool(pool, recordDatabaseMeasurement)

export const kitzDb = pool ? drizzle(pool, { schema }) : null
export const db = kitzDb

export const adminPool = adminConnectionUrl
  ? createPool(
    adminConnectionUrl,
    'kitculture-admin',
    { caFile: env.ADMIN_SUPABASE_CA_CERT_FILE, caContents: env.ADMIN_SUPABASE_CA_CERT },
  )
  : null
export const adminDb = adminPool ? drizzle(adminPool, { schema: adminSchema }) : null