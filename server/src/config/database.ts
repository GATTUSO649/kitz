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

export function kitzPostgresSslOptions(configuration = env) {
  return createPostgresSslOptions({
    caFile: configuration.SUPABASE_CA_CERT_FILE,
    caContents: configuration.SUPABASE_CA_CERT,
  }, {
    requireCa: configuration.NODE_ENV === 'production',
    connectionName: 'Kitz DATABASE_URL',
    caFileVariable: 'SUPABASE_CA_CERT_FILE',
    caContentsVariable: 'SUPABASE_CA_CERT',
  })
}

export function adminPostgresSslOptions(configuration = env) {
  return createPostgresSslOptions({
    caFile: configuration.ADMIN_SUPABASE_CA_CERT_FILE,
    caContents: configuration.ADMIN_SUPABASE_CA_CERT,
  }, {
    requireCa: configuration.NODE_ENV === 'production',
    connectionName: 'Admin ADMIN_DATABASE_URL',
    caFileVariable: 'ADMIN_SUPABASE_CA_CERT_FILE',
    caContentsVariable: 'ADMIN_SUPABASE_CA_CERT',
  })
}

function createPool(connectionUrl: URL, applicationName: string, ssl: ReturnType<typeof kitzPostgresSslOptions>): Pool {
  return new Pool({
    connectionString: connectionUrl.toString(),
    ssl,
    max: 10,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 30_000,
    application_name: applicationName,
  })
}

export const pool = connectionUrl ? createPool(connectionUrl, 'kitculture-api', kitzPostgresSslOptions()) : null

if (pool && process.env.NODE_TEST_CONTEXT === undefined) instrumentPostgresPool(pool, recordDatabaseMeasurement)

export const kitzDb = pool ? drizzle(pool, { schema }) : null
export const db = kitzDb

export const adminPool = adminConnectionUrl
  ? createPool(
    adminConnectionUrl,
    'kitculture-admin',
    adminPostgresSslOptions(),
  )
  : null
export const adminDb = adminPool ? drizzle(adminPool, { schema: adminSchema }) : null