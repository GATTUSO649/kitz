import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL?.trim()
const caFile = process.env.SUPABASE_CA_CERT_FILE?.trim()

if (!databaseUrl) {
  console.error('Connection not attempted: DATABASE_URL is not configured.')
  process.exitCode = 1
} else if (!caFile) {
  console.error('Connection not attempted: SUPABASE_CA_CERT_FILE is not configured.')
  process.exitCode = 1
} else {
  let ca
  try {
    ca = await readFile(resolve(caFile), 'utf8')
    if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
      throw new Error('Invalid PEM certificate')
    }
  } catch {
    console.error('Connection not attempted: CA certificate file is unreadable or is not a PEM certificate.')
    process.exitCode = 1
  }

  if (ca) {
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
        ssl: { rejectUnauthorized: true, ca },
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