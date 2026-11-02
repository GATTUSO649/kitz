import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL?.trim()
const caFile = process.env.SUPABASE_CA_CERT_FILE?.trim()
const expectedTableCount = 46

if (!databaseUrl) {
  console.error('Schema creation not attempted: DATABASE_URL is not configured.')
  process.exitCode = 1
} else if (!caFile) {
  console.error('Schema creation not attempted: SUPABASE_CA_CERT_FILE is not configured.')
  process.exitCode = 1
} else {
  let ca
  let migration
  try {
    ca = await readFile(resolve(caFile), 'utf8')
    if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
      throw new Error('Invalid PEM certificate')
    }
    migration = await readFile(new URL('../src/database/postgres-drizzle-migrations/0000_jittery_brother_voodoo.sql', import.meta.url), 'utf8')
  } catch {
    console.error('Schema creation not attempted: CA certificate or baseline migration is missing or invalid.')
    process.exitCode = 1
  }

  if (ca && migration) {
    let connectionUrl
    try {
      connectionUrl = new URL(databaseUrl)
      if (!['postgres:', 'postgresql:'].includes(connectionUrl.protocol)) throw new Error('Invalid database protocol')
      for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) {
        connectionUrl.searchParams.delete(key)
      }
    } catch {
      console.error('Schema creation not attempted: DATABASE_URL is not a valid PostgreSQL URL.')
      process.exitCode = 1
    }

    if (connectionUrl) {
      const client = new pg.Client({
        connectionString: connectionUrl.toString(),
        ssl: { rejectUnauthorized: true, ca },
        connectionTimeoutMillis: 10_000,
        application_name: 'kitculture-schema-setup',
      })

      try {
        await client.connect()
        await client.query('BEGIN')
        const { rows: schemaRows } = await client.query('SELECT current_schema() AS schema_name')
        if (schemaRows[0]?.schema_name !== 'public') throw new Error('Unexpected schema')
        const { rows: tableRows } = await client.query(
          "SELECT count(*)::integer AS total FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
        )
        if (tableRows[0]?.total !== 0) throw new Error('Target schema is not empty')

        await client.query(migration)
        await client.query(`DO $$
          DECLARE table_record record;
          BEGIN
            FOR table_record IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
              EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_record.tablename);
            END LOOP;
          END
        $$;`)
        const { rows: resultRows } = await client.query(
          "SELECT count(*)::integer AS total FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
        )
        const { rows: rlsRows } = await client.query(
          "SELECT count(*)::integer AS total FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity",
        )
        if (resultRows[0]?.total !== expectedTableCount || rlsRows[0]?.total !== expectedTableCount) throw new Error('Unexpected schema or RLS count')
        await client.query('COMMIT')
        console.log(`Created ${expectedTableCount} KitCulture tables in the empty Supabase public schema.`)
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        const code = typeof error?.code === 'string' ? error.code : 'SAFE_GUARD_OR_MIGRATION_ERROR'
        console.error(`Schema creation failed and was rolled back; error code: ${code}. Sensitive details were suppressed.`)
        process.exitCode = 1
      } finally {
        await client.end().catch(() => {})
      }
    }
  }
}