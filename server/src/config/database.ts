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
const connectionUrl = databaseUrl ? new URL(databaseUrl) : null
if (connectionUrl) {
  for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) connectionUrl.searchParams.delete(key)
}

export const pool = connectionUrl
  ? new Pool({
      connectionString: connectionUrl.toString(),
      ssl: supabaseSslOptions(env.SUPABASE_CA_CERT_FILE, env.SUPABASE_CA_CERT, env.NODE_ENV === 'production'),
      max: 10,
      connectionTimeoutMillis: 8_000,
      idleTimeoutMillis: 30_000,
      application_name: 'kitculture-api',
    })
  : null

if (pool && process.env.NODE_TEST_CONTEXT === undefined) instrumentPostgresPool(pool, recordDatabaseMeasurement)

export const db = pool ? drizzle(pool, { schema }) : null

export const adminPool = pool
export const adminDb = pool ? drizzle(pool, { schema: adminSchema }) : null