import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

if (!process.env.MARKETPLACE_MIGRATION_DATABASE_URL) {
  throw new Error('MARKETPLACE_MIGRATION_DATABASE_URL is required for marketplace migrations.')
}
let databaseUrl: URL
try {
  databaseUrl = new URL(process.env.MARKETPLACE_MIGRATION_DATABASE_URL)
} catch {
  throw new Error('MARKETPLACE_MIGRATION_DATABASE_URL must be a valid PostgreSQL connection URL.')
}
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
  throw new Error('MARKETPLACE_MIGRATION_DATABASE_URL must use the PostgreSQL protocol.')
}
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ''))
if (!process.env.MARKETPLACE_DATABASE_NAME || databaseName !== process.env.MARKETPLACE_DATABASE_NAME) {
  throw new Error('MARKETPLACE_DATABASE_NAME must match the database name in MARKETPLACE_MIGRATION_DATABASE_URL.')
}
if (!process.env.MARKETPLACE_DATABASE_HOST || databaseUrl.hostname.toLowerCase() !== process.env.MARKETPLACE_DATABASE_HOST.toLowerCase()) {
  throw new Error('MARKETPLACE_DATABASE_HOST must exactly match the host in MARKETPLACE_DATABASE_URL.')
}
if (process.env.NODE_ENV === 'production' && !databaseUrl.hostname.toLowerCase().endsWith('.supabase.co') && !databaseUrl.hostname.toLowerCase().endsWith('.pooler.supabase.com')) {
  throw new Error('Production MARKETPLACE_DATABASE_HOST must be a Supabase PostgreSQL endpoint.')
}
if (process.env.MARKETPLACE_DATABASE_SCHEMA !== 'marketplace') {
  throw new Error('MARKETPLACE_DATABASE_SCHEMA must be marketplace.')
}
if (process.env.NODE_ENV === 'production' && !process.env.MARKETPLACE_DATABASE_CA) {
  throw new Error('MARKETPLACE_DATABASE_CA is required in production.')
}
const sslCa = process.env.MARKETPLACE_DATABASE_CA?.replaceAll('\\n', '\n')

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/src/database/schema.ts',
  schemaFilter: ['marketplace'],
  out: './server/src/database/marketplace-migrations',
  dbCredentials: {
    host: databaseUrl.hostname,
    port: databaseUrl.port ? Number(databaseUrl.port) : 5432,
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: databaseName,
    ...((sslCa || process.env.NODE_ENV === 'production' || databaseUrl.hostname.toLowerCase().endsWith('.supabase.co') || databaseUrl.hostname.toLowerCase().endsWith('.pooler.supabase.com')) ? { ssl: { ...(sslCa ? { ca: sslCa } : {}), rejectUnauthorized: true } } : {}),
  },
  migrations: { schema: 'marketplace', table: '__drizzle_migrations' },
  strict: true,
  verbose: true,
})