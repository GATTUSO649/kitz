import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from './env.js'
import * as schema from '../database/schema.js'
import * as adminSchema from '../database/admin-schema.js'

export function mysqlSslOptions(nodeEnvironment: string, ca?: string) {
  if (nodeEnvironment !== 'production') return undefined
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
}

function supabaseSslOptions(caFile?: string) {
  if (!caFile) return { rejectUnauthorized: true }
  let ca: string
  try {
    ca = readFileSync(resolve(caFile), 'utf8')
  } catch {
    throw new Error('SUPABASE_CA_CERT_FILE could not be read.')
  }
  if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    throw new Error('SUPABASE_CA_CERT_FILE must point to a PEM certificate.')
  }
  return { rejectUnauthorized: true, ca }
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
      ssl: supabaseSslOptions(env.SUPABASE_CA_CERT_FILE),
      max: 10,
      connectionTimeoutMillis: 8_000,
      idleTimeoutMillis: 30_000,
      application_name: 'kitculture-api',
    })
  : null

export const db = pool ? drizzle(pool, { schema }) : null

export const adminPool = pool
export const adminDb = pool ? drizzle(pool, { schema: adminSchema }) : null