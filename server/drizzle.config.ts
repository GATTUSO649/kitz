import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL must be set for PostgreSQL schema operations.')
const connectionUrl = new URL(databaseUrl)
if (!['postgres:', 'postgresql:'].includes(connectionUrl.protocol)) {
  throw new Error('DATABASE_URL must use the PostgreSQL protocol for Drizzle operations.')
}
for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) connectionUrl.searchParams.delete(key)

const caFile = process.env.SUPABASE_CA_CERT_FILE?.trim()
let ca: string | undefined
if (caFile) {
  try {
    ca = readFileSync(resolve(caFile), 'utf8')
  } catch {
    throw new Error('SUPABASE_CA_CERT_FILE could not be read.')
  }
  if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    throw new Error('SUPABASE_CA_CERT_FILE must point to a PEM certificate.')
  }
}

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./server/src/database/schema.ts', './server/src/database/admin-schema.ts'],
  out: './server/src/database/postgres-drizzle-migrations',
  dbCredentials: {
    host: connectionUrl.hostname,
    port: Number(connectionUrl.port || 5432),
    user: decodeURIComponent(connectionUrl.username),
    password: decodeURIComponent(connectionUrl.password),
    database: decodeURIComponent(connectionUrl.pathname.slice(1)),
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  },
})