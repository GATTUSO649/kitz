import 'dotenv/config'
import pg from 'pg'
import { createPostgresSslOptions } from '../src/config/postgres-ssl.mjs'

const databaseUrl = process.env.DATABASE_URL?.trim()
const caFile = process.env.SUPABASE_CA_CERT_FILE?.trim()
const caContents = process.env.SUPABASE_CA_CERT?.trim()

if (!databaseUrl) {
  console.error('Connection not attempted: DATABASE_URL is not configured.')
  process.exitCode = 1
} else if (!caFile && !caContents) {
  console.error('Connection not attempted: a Supabase CA file or PEM is not configured.')
  process.exitCode = 1
} else {
  let ssl
  try {
    ssl = createPostgresSslOptions({ caFile, caContents })
  } catch {
    console.error('Connection not attempted: Supabase CA configuration is unreadable or invalid.')
    process.exitCode = 1
  }

  if (ssl) {
    let connectionUrl
    try {
      connectionUrl = new URL(databaseUrl)
      if (!['postgres:', 'postgresql:'].includes(connectionUrl.protocol)) throw new Error('Invalid database protocol')
      for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) {
        connectionUrl.searchParams.delete(key)
      }
    } catch {
      console.error('Connection not attempted: DATABASE_URL is not a valid PostgreSQL URL.')
      process.exitCode = 1
    }

    if (connectionUrl) {
      const client = new pg.Client({
        connectionString: connectionUrl.toString(),
        ssl,
        connectionTimeoutMillis: 10_000,
        application_name: 'kitculture-connectivity-check',
      })

      try {
        await client.connect()
        const result = await client.query('SELECT 1 AS ok')
        if (result.rows[0]?.ok !== 1) throw Object.assign(new Error(), { code: 'UNEXPECTED_RESULT' })
        console.log('Supabase PostgreSQL TLS verification succeeded; read-only SELECT 1 returned successfully.')
      } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
        console.error(`Supabase connection/query failed; error code: ${code}. Sensitive details were suppressed.`)
        process.exitCode = 1
      } finally {
        await client.end().catch(() => {})
      }
    }
  }
}