import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

function createPool() {
  const connectionString = process.env.MARKETPLACE_DATABASE_URL
  if (!connectionString) return null
  const expectedDatabaseName = process.env.MARKETPLACE_DATABASE_NAME
  const actualDatabaseName = decodeURIComponent(new URL(connectionString).pathname.replace(/^\/+/, ''))
  if (!expectedDatabaseName || actualDatabaseName !== expectedDatabaseName || !/(?:^|[_-])marketplace$/i.test(actualDatabaseName)) {
    throw new Error('MARKETPLACE_DATABASE_NAME must match a dedicated marketplace database in the connection URL.')
  }
  const sslCa = process.env.MARKETPLACE_DATABASE_CA
  if (process.env.NODE_ENV === 'production' && !sslCa) {
    throw new Error('MARKETPLACE_DATABASE_CA is required in production.')
  }
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(sslCa ? { ssl: { ca: sslCa.replaceAll('\\n', '\n'), rejectUnauthorized: true } } : {}),
  })
}

export const pool = createPool()
export const database: NodePgDatabase<typeof schema> | null = pool ? drizzle(pool, { schema }) : null