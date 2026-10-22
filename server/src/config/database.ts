import { drizzle } from 'drizzle-orm/mysql2'
import { createPool } from 'mysql2/promise'
import { env } from './env.js'
import * as schema from '../database/schema.js'
import * as adminSchema from '../database/admin-schema.js'

export function mysqlSslOptions(nodeEnvironment: string, ca?: string) {
  if (nodeEnvironment !== 'production') return undefined
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
}

const mysqlSsl = mysqlSslOptions(env.NODE_ENV, env.MYSQL_SSL_CA)
const databaseUrl = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null
export const pool = databaseUrl
  ? createPool({
      host: databaseUrl.hostname,
      port: databaseUrl.port ? Number(databaseUrl.port) : 3306,
      user: decodeURIComponent(databaseUrl.username),
      password: decodeURIComponent(databaseUrl.password),
      database: databaseUrl.pathname.slice(1),
      ssl: mysqlSsl,
      connectionLimit: 10,
      waitForConnections: true,
      enableKeepAlive: true,
    })
  : null

export const db = pool ? drizzle(pool, { schema, mode: 'default' }) : null

const adminDatabaseUrl = env.ADMIN_DATABASE_URL ? new URL(env.ADMIN_DATABASE_URL) : null
export const adminPool = adminDatabaseUrl
  ? createPool({
      host: adminDatabaseUrl.hostname,
      port: adminDatabaseUrl.port ? Number(adminDatabaseUrl.port) : 3306,
      user: decodeURIComponent(adminDatabaseUrl.username),
      password: decodeURIComponent(adminDatabaseUrl.password),
      database: adminDatabaseUrl.pathname.slice(1),
      ssl: mysqlSsl,
      connectionLimit: 5,
      waitForConnections: true,
      enableKeepAlive: true,
    })
  : null

export const adminDb = adminPool ? drizzle(adminPool, { schema: adminSchema, mode: 'default' }) : null