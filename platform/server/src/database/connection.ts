import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

export function getMarketplaceDatabaseConfig(env: NodeJS.ProcessEnv = process.env) {
  const connectionString = env.MARKETPLACE_DATABASE_URL
  if (!connectionString) {
    if (env.NODE_ENV === 'production') throw new Error('MARKETPLACE_DATABASE_URL is required in production.')
    return null
  }

  let connectionUrl: URL
  try {
    connectionUrl = new URL(connectionString)
  } catch {
    throw new Error('MARKETPLACE_DATABASE_URL must be a valid PostgreSQL connection URL.')
  }
  const actualDatabaseName = decodeURIComponent(connectionUrl.pathname.replace(/^\/+/, ''))
  const expectedDatabaseName = env.MARKETPLACE_DATABASE_NAME
  const expectedHost = env.MARKETPLACE_DATABASE_HOST?.toLowerCase()
  const expectedUser = env.MARKETPLACE_DATABASE_USER
  const isSupabaseHost = connectionUrl.hostname.toLowerCase().endsWith('.supabase.co') || connectionUrl.hostname.toLowerCase().endsWith('.pooler.supabase.com')
  if (!['postgres:', 'postgresql:'].includes(connectionUrl.protocol)) {
    throw new Error('MARKETPLACE_DATABASE_URL must use the PostgreSQL protocol.')
  }
  if (!expectedDatabaseName || actualDatabaseName !== expectedDatabaseName) {
    throw new Error('MARKETPLACE_DATABASE_NAME must match the database name in MARKETPLACE_DATABASE_URL.')
  }
  if (!expectedHost || connectionUrl.hostname.toLowerCase() !== expectedHost) {
    throw new Error('MARKETPLACE_DATABASE_HOST must exactly match the host in MARKETPLACE_DATABASE_URL.')
  }
  if (env.NODE_ENV === 'production' && !isSupabaseHost) {
    throw new Error('Production MARKETPLACE_DATABASE_HOST must be a Supabase PostgreSQL endpoint.')
  }
  if (!expectedUser || decodeURIComponent(connectionUrl.username) !== expectedUser) {
    throw new Error('MARKETPLACE_DATABASE_USER must exactly match the user in MARKETPLACE_DATABASE_URL.')
  }
  if (env.MARKETPLACE_DATABASE_SCHEMA !== 'marketplace') {
    throw new Error('MARKETPLACE_DATABASE_SCHEMA must be marketplace.')
  }

  const sslCa = env.MARKETPLACE_DATABASE_CA?.replaceAll('\\n', '\n')
  if (env.NODE_ENV === 'production' && !sslCa) {
    throw new Error('MARKETPLACE_DATABASE_CA is required in production.')
  }
  return {
    connectionString,
    ssl: env.NODE_ENV === 'production' || isSupabaseHost || sslCa ? { ...(sslCa ? { ca: sslCa } : {}), rejectUnauthorized: true } : undefined,
  }
}

function createPool() {
  const config = getMarketplaceDatabaseConfig()
  if (!config) return null
  return new Pool({
    connectionString: config.connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(config.ssl ? { ssl: config.ssl } : {}),
  })
}

export const pool = createPool()
export const database: NodePgDatabase<typeof schema> | null = pool ? drizzle(pool, { schema }) : null