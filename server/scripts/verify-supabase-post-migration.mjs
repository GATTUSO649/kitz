import 'dotenv/config'
import pg from 'pg'
import { createPostgresSslOptions } from '../src/config/postgres-ssl.mjs'

const databaseUrl = process.env.DATABASE_URL?.trim()
const caFile = process.env.SUPABASE_CA_CERT_FILE?.trim()
const caContents = process.env.SUPABASE_CA_CERT?.trim()

if (!databaseUrl || (!caFile && !caContents)) {
  console.error('Post-migration verification not attempted: database or CA configuration is missing.')
  process.exitCode = 1
} else {
  const url = new URL(databaseUrl)
  for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key)
  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: createPostgresSslOptions({ caFile, caContents }),
    application_name: 'kitculture-post-migration-verification',
  })

  try {
    await client.connect()
    const tracker = await client.query("SELECT to_regclass($1) AS object", ['drizzle.__drizzle_migrations'])
    const monitoringEvents = await client.query("SELECT to_regclass($1) AS object", ['public.monitoring_events'])
    const drizzleHistory = await client.query('SELECT count(*)::integer AS total FROM drizzle.__drizzle_migrations')
    console.log(JSON.stringify({
      drizzleTracker: tracker.rows[0]?.object ?? null,
      monitoringEvents: monitoringEvents.rows[0]?.object ?? null,
      drizzleHistoryRows: drizzleHistory.rows[0]?.total ?? 0,
    }))
  } catch {
    console.error('Post-migration catalog verification failed.')
    process.exitCode = 1
  } finally {
    await client.end().catch(() => {})
  }
}
