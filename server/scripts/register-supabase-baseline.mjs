import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { createPostgresSslOptions } from '../src/config/postgres-ssl.mjs'

const databaseUrl = process.env.DATABASE_URL?.trim()
const caFile = process.env.SUPABASE_CA_CERT_FILE?.trim()
const caContents = process.env.SUPABASE_CA_CERT?.trim()
const migrationUrl = new URL('../src/database/postgres-drizzle-migrations/0000_jittery_brother_voodoo.sql', import.meta.url)
const journalUrl = new URL('../src/database/postgres-drizzle-migrations/meta/_journal.json', import.meta.url)

if (!databaseUrl) {
  console.error('Baseline registration not attempted: DATABASE_URL is not configured.')
  process.exitCode = 1
} else if (!caFile && !caContents) {
  console.error('Baseline registration not attempted: a Supabase CA file or PEM is not configured.')
  process.exitCode = 1
} else {
  let ssl
  let migration
  let journal
  try {
    ssl = createPostgresSslOptions({ caFile, caContents })
    migration = await readFile(migrationUrl, 'utf8')
    journal = JSON.parse(await readFile(journalUrl, 'utf8'))
  } catch {
    console.error('Baseline registration not attempted: CA or generated migration metadata is missing or invalid.')
    process.exitCode = 1
  }

  if (ssl && migration && journal) {
    const baseline = journal.entries?.find((entry) => entry.idx === 0)
    if (!baseline || baseline.tag !== '0000_jittery_brother_voodoo' || baseline.idx !== 0) {
      console.error('Baseline registration not attempted: generated migration history is missing the expected initial baseline.')
      process.exitCode = 1
    } else {
      const url = new URL(databaseUrl)
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        console.error('Baseline registration not attempted: DATABASE_URL is not PostgreSQL.')
        process.exitCode = 1
      } else {
        for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key)
        const client = new pg.Client({
          connectionString: url.toString(),
          ssl,
          connectionTimeoutMillis: 10_000,
          application_name: 'kitculture-baseline-registration',
        })

        try {
          await client.connect()
          await client.query('BEGIN')
          const schema = await client.query('SELECT current_schema() AS name')
          const tables = await client.query("SELECT count(*)::integer AS total FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
          const foreignKeys = await client.query("SELECT count(*)::integer AS total FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace")
          const indexes = await client.query("SELECT count(*)::integer AS total FROM pg_indexes WHERE schemaname = 'public'")
          const rowSecurity = await client.query("SELECT count(*)::integer AS total FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity")

          if (schema.rows[0]?.name !== 'public'
            || tables.rows[0]?.total !== 46
            || foreignKeys.rows[0]?.total !== 54
            || indexes.rows[0]?.total !== 113
            || rowSecurity.rows[0]?.total !== 46) {
            throw new Error('Baseline schema verification failed')
          }

          const existingHistory = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'")
          let alreadyRegistered = false
          if (existingHistory.rows.length) {
            const rows = await client.query('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at')
            if (rows.rows.length > 1) throw new Error('Unexpected migration history')
            if (rows.rows.length === 1) {
              const expectedHash = createHash('sha256').update(migration).digest('hex')
              if (rows.rows[0].hash !== expectedHash || Number(rows.rows[0].created_at) !== baseline.when) {
                throw new Error('Existing migration history does not match the baseline')
              }
              alreadyRegistered = true
            }
          }

          if (!alreadyRegistered) {
            await client.query('CREATE SCHEMA IF NOT EXISTS drizzle')
            await client.query('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)')
            const expectedHash = createHash('sha256').update(migration).digest('hex')
            await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [expectedHash, baseline.when])
          }
          await client.query('COMMIT')
          console.log(alreadyRegistered
            ? 'Supabase baseline is already registered with Drizzle.'
            : 'Verified Supabase baseline registered with Drizzle; no application tables were changed.')
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {})
          const code = typeof error?.code === 'string' ? error.code : 'SAFE_GUARD_OR_REGISTRATION_ERROR'
          console.error(`Baseline registration failed and was rolled back; error code: ${code}. Sensitive details were suppressed.`)
          process.exitCode = 1
        } finally {
          await client.end().catch(() => {})
        }
      }
    }
  }
}