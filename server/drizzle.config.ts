import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'
import { createPostgresSslOptions } from './src/config/postgres-ssl.mjs'

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL must be set for PostgreSQL schema operations.')
const connectionUrl = new URL(databaseUrl)
if (!['postgres:', 'postgresql:'].includes(connectionUrl.protocol)) {
  throw new Error('DATABASE_URL must use the PostgreSQL protocol for Drizzle operations.')
}
for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) connectionUrl.searchParams.delete(key)

const ssl = createPostgresSslOptions({
  caFile: process.env.SUPABASE_CA_CERT_FILE,
  caContents: process.env.SUPABASE_CA_CERT,
})

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
    ssl,
  },
})