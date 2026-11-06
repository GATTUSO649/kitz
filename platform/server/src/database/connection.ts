import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { safeDatabaseError } from './diagnostics.js'
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
  let config: ReturnType<typeof getMarketplaceDatabaseConfig>
  try {
    config = getMarketplaceDatabaseConfig()
  } catch (error) {
    console.error('MarketHub startup database diagnostic', {
      databaseUrlConfigured: Boolean(process.env.MARKETPLACE_DATABASE_URL),
      configuredDatabaseName: process.env.MARKETPLACE_DATABASE_NAME ?? null,
      configuredSchema: process.env.MARKETPLACE_DATABASE_SCHEMA ?? null,
      connectionPool: { configured: false, total: 0, idle: 0, waiting: 0 },
      databaseConnected: false,
      configurationValid: false,
      configurationError: error instanceof Error ? error.message : 'Marketplace database configuration validation failed.',
    })
    throw error
  }
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
export function marketplaceDatabaseConnectionState() {
  return {
    configured: Boolean(pool),
    total: pool?.totalCount ?? 0,
    idle: pool?.idleCount ?? 0,
    waiting: pool?.waitingCount ?? 0,
  }
}

export async function marketplaceDatabaseStartupDiagnostic(databaseClient: Pick<Pool, 'query'> | null = pool, env: NodeJS.ProcessEnv = process.env) {
  const diagnostic = {
    databaseUrlConfigured: Boolean(env.MARKETPLACE_DATABASE_URL),
    configuredDatabaseName: env.MARKETPLACE_DATABASE_NAME ?? null,
    configuredSchema: env.MARKETPLACE_DATABASE_SCHEMA ?? null,
    connectionPool: marketplaceDatabaseConnectionState(),
  }
  if (!databaseClient) return { ...diagnostic, databaseConnected: false, actualDatabaseName: null, databaseError: null }

  try {
    const result = await databaseClient.query('SELECT current_database() AS database_name')
    const actualDatabaseName = result.rows[0]?.database_name
    return {
      ...diagnostic,
      connectionPool: marketplaceDatabaseConnectionState(),
      databaseConnected: true,
      actualDatabaseName: typeof actualDatabaseName === 'string' ? actualDatabaseName : null,
      databaseError: null,
    }
  } catch (error) {
    return {
      ...diagnostic,
      connectionPool: marketplaceDatabaseConnectionState(),
      databaseConnected: false,
      actualDatabaseName: null,
      databaseError: safeDatabaseError(error, env) ?? { name: 'DatabaseError', message: 'PostgreSQL startup connection probe failed.', code: undefined, failureKind: 'database_error' as const },
    }
  }
}

pool?.on('error', (error) => {
  console.error('MarketHub PostgreSQL pool error', {
    operation: 'postgres_pool_idle_client',
    databaseError: safeDatabaseError(error),
    databaseConnection: marketplaceDatabaseConnectionState(),
  })
})

export const database: NodePgDatabase<typeof schema> | null = pool ? drizzle(pool, { schema }) : null