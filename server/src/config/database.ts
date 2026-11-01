import { drizzle } from 'drizzle-orm/mysql2'
import { createPool } from 'mysql2/promise'
import { env, resolveDatabaseUrl } from './env.js'
import * as schema from '../database/schema.js'
import * as adminSchema from '../database/admin-schema.js'

export function mysqlSslOptions(nodeEnvironment: string, ca?: string) {
  if (nodeEnvironment !== 'production') return undefined
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
}

const mysqlSsl = mysqlSslOptions(env.NODE_ENV, env.MYSQL_SSL_CA)
const databaseUrl = resolveDatabaseUrl('DATABASE_URL', ['MYSQL_URL', 'MYSQL_URI'])
export const pool = databaseUrl
  ? createPool({
      host: new URL(databaseUrl).hostname,
      port: Number(new URL(databaseUrl).port || 3306),
      user: decodeURIComponent(new URL(databaseUrl).username),
      password: decodeURIComponent(new URL(databaseUrl).password),
      database: new URL(databaseUrl).pathname.slice(1),
      ssl: mysqlSsl,
      connectionLimit: 10,
      waitForConnections: true,
      queueLimit: 0,
      enableKeepAlive: true,
      connectTimeout: 8_000,
    })
  : null

export const db = pool ? drizzle(pool, { schema, mode: 'default' }) : null

export const adminPool = pool
export const adminDb = pool ? drizzle(pool, { schema: adminSchema, mode: 'default' }) : null