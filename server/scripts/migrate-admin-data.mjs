import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { createPostgresSslOptions } from '../src/config/postgres-ssl.mjs'

const adminTables = [
  'admin_users',
  'admin_setup_locks',
  'admin_permissions',
  'admin_role_permissions',
  'operations_users',
  'admin_sessions',
  'admin_verification_tokens',
  'admin_audit_logs',
  'admin_invitations',
  'admin_login_attempts',
  'admin_user_permissions',
  'operations_operators',
  'operations_sessions',
  'operations_incidents',
  'operations_incident_events',
  'operations_audit_events',
  'monitoring_events',
  'monitoring_detection_rules',
  'monitoring_detection_history',
  'monitoring_worker_state',
  'monitoring_alerts',
  'security_scans',
  'security_scan_modules',
  'security_findings',
  'security_finding_events',
  'security_scanner_health',
  'security_scan_schedules',
]
const targetTableAllowlist = new Set([
  ...adminTables,
  'admin_database_migration_runs',
  '__drizzle_admin_migrations',
])
const sessionTables = new Set(['admin_sessions', 'operations_sessions'])
const batchSize = 100
const generatedRunId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}-${randomUUID()}`
const runId = process.env.ADMIN_MIGRATION_RUN_ID?.trim() || generatedRunId
const execute = process.argv.includes('--execute')
const sourceUrl = process.env.DATABASE_URL?.trim()
const targetUrl = process.env.ADMIN_MIGRATION_DATABASE_URL?.trim()
const runtimeAdminUrl = process.env.ADMIN_DATABASE_URL?.trim()
const sourceIdentity = process.env.KITZ_SOURCE_IDENTITY?.trim()
const targetIdentity = process.env.ADMIN_MIGRATION_TARGET_IDENTITY?.trim()

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function databaseTargetIdentity(value) {
  try {
    const url = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null
    const directProject = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname)?.[1]
    const pooledProject = /^(?:postgres|supabase_admin)\.([a-z0-9-]+)$/i.exec(decodeURIComponent(url.username))?.[1]
    const project = directProject ?? pooledProject
    return project ? `supabase:${project.toLowerCase()}` : null
  } catch {
    return null
  }
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) throw new Error('Invalid migration identifier.')
  return `"${identifier}"`
}

function stableValue(value) {
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return value.toString('hex')
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  }
  return value
}

function sameRow(left, right, columns) {
  return columns.every((column) => JSON.stringify(stableValue(left[column])) === JSON.stringify(stableValue(right[column])))
}

function validateConfiguration() {
  requireValue(sourceUrl, 'DATABASE_URL')
  requireValue(targetUrl, 'ADMIN_MIGRATION_DATABASE_URL')
  requireValue(runtimeAdminUrl, 'ADMIN_DATABASE_URL')
  requireValue(sourceIdentity, 'KITZ_SOURCE_IDENTITY')
  requireValue(targetIdentity, 'ADMIN_MIGRATION_TARGET_IDENTITY')
  if (!/^\d{8}T\d{6}Z-[a-f0-9-]{36}$/i.test(runId)) throw new Error('ADMIN_MIGRATION_RUN_ID must use YYYYMMDDTHHMMSSZ-<uuid> format.')
  if (databaseTargetIdentity(sourceUrl) !== sourceIdentity) throw new Error('DATABASE_URL does not match KITZ_SOURCE_IDENTITY.')
  if (databaseTargetIdentity(targetUrl) !== targetIdentity) throw new Error('ADMIN_MIGRATION_DATABASE_URL does not match ADMIN_MIGRATION_TARGET_IDENTITY.')
  if (databaseTargetIdentity(runtimeAdminUrl) !== targetIdentity) throw new Error('ADMIN_DATABASE_URL and migration URL must identify the same Admin project.')
  if (sourceIdentity === targetIdentity) throw new Error('Kitz source and Admin target must be separate projects.')
  if (process.env.ADMIN_MIGRATION_APPROVED !== 'YES'
    || process.env.ADMIN_BACKUP_VERIFIED !== 'YES'
    || process.env.ADMIN_STAGING_VERIFIED !== 'YES') {
    throw new Error('Migration requires explicit approval, a verified backup, and successful staging verification.')
  }
  if (execute && process.env.ADMIN_MIGRATION_EXECUTE !== 'YES') {
    throw new Error('Set ADMIN_MIGRATION_EXECUTE=YES for the explicitly approved data-copy run.')
  }
}

function createPool(connectionString, caFile, caContents, readOnly = false) {
  return new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 60_000,
    ...(readOnly ? { options: '-c default_transaction_read_only=on' } : {}),
    ssl: createPostgresSslOptions({ caFile, caContents }, { requireCa: true }),
  })
}

async function getTableShape(client, table) {
  const columns = await client.query(`
    SELECT column_name, data_type, udt_name, character_maximum_length,
           numeric_precision, numeric_scale, datetime_precision, is_nullable,
           is_identity, identity_generation
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [table])
  if (!columns.rowCount) throw new Error(`Missing table: ${table}`)

  const primaryKey = await client.query(`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_catalog = kcu.constraint_catalog
      AND tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
      AND tc.table_name = kcu.table_name
    WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.ordinal_position
  `, [table])
  if (!primaryKey.rowCount) throw new Error(`Missing primary key: ${table}`)
  return { columns: columns.rows, primaryKey: primaryKey.rows.map(({ column_name }) => column_name) }
}

function assertCompatibleShapes(table, sourceShape, targetShape) {
  const normalize = (shape) => shape.columns.map((column) => JSON.stringify(column)).join('|')
  if (normalize(sourceShape) !== normalize(targetShape)
    || JSON.stringify(sourceShape.primaryKey) !== JSON.stringify(targetShape.primaryKey)) {
    throw new Error(`Schema mismatch: ${table}`)
  }
}

async function countRows(client, table) {
  const result = await client.query(`SELECT count(*)::text AS count FROM public.${quoteIdentifier(table)}`)
  return Number(result.rows[0].count)
}

async function saveRun(target, status, summary, errorCode = null) {
  await target.query(`
    UPDATE public.admin_database_migration_runs
    SET status = $2, summary = $3::jsonb, error_code = $4,
        completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END
    WHERE migration_id = $1
  `, [runId, status, JSON.stringify(summary), errorCode])
}

async function beginOrResumeRun(target) {
  const existing = await target.query(`
    SELECT source_identity, target_identity, status, summary, started_at
    FROM public.admin_database_migration_runs WHERE migration_id = $1
  `, [runId])
  if (existing.rowCount) {
    const run = existing.rows[0]
    if (run.source_identity !== sourceIdentity || run.target_identity !== targetIdentity) {
      throw new Error('Run identity mismatch.')
    }
    if (run.status === 'completed') throw new Error('Run already completed.')
    await target.query(`UPDATE public.admin_database_migration_runs SET status = 'in_progress', error_code = NULL WHERE migration_id = $1`, [runId])
    return { startedAt: run.started_at, summary: run.summary ?? {} }
  }
  const created = await target.query(`
    INSERT INTO public.admin_database_migration_runs
      (migration_id, source_identity, target_identity, status, summary)
    VALUES ($1, $2, $3, 'in_progress', '{}'::jsonb)
    RETURNING started_at
  `, [runId, sourceIdentity, targetIdentity])
  return { startedAt: created.rows[0].started_at, summary: {} }
}

async function copyTable(source, target, table, summary) {
  const sourceShape = await getTableShape(source, table)
  const targetShape = await getTableShape(target, table)
  assertCompatibleShapes(table, sourceShape, targetShape)

  const columnNames = sourceShape.columns.map(({ column_name }) => column_name)
  const quotedColumns = columnNames.map(quoteIdentifier)
  const keyNames = sourceShape.primaryKey
  const quotedKeys = keyNames.map(quoteIdentifier)
  const sourceCount = await countRows(source, table)
  const targetCountBefore = await countRows(target, table)
  const invalidateSessions = sessionTables.has(table)
  const result = {
    sourceCount,
    eligibleSourceCount: invalidateSessions ? 0 : sourceCount,
    invalidatedSessions: invalidateSessions ? sourceCount : 0,
    inserted: 0,
    alreadyPresent: 0,
    rejected: 0,
    targetCountBefore,
    targetCountAfter: targetCountBefore,
    verified: false,
  }

  if (invalidateSessions) {
    if (targetCountBefore !== 0) throw new Error(`Unexpected destination sessions: ${table}`)
  } else {
    let lastKey = null
    while (true) {
      const parameters = []
      let where = ''
      if (lastKey) {
        const tuple = `(${quotedKeys.join(', ')})`
        const values = `(${lastKey.map((value) => {
          parameters.push(value)
          return `$${parameters.length}`
        }).join(', ')})`
        where = `WHERE ${tuple} > ${values}`
      }
      parameters.push(batchSize)
      const rows = await source.query(`
        SELECT ${quotedColumns.join(', ')}
        FROM public.${quoteIdentifier(table)} ${where}
        ORDER BY ${quotedKeys.join(', ')}
        LIMIT $${parameters.length}
      `, parameters)
      if (!rows.rowCount) break

      const values = []
      const insertTuples = rows.rows.map((row) => `(${columnNames.map((column) => {
        values.push(row[column])
        return `$${values.length}`
      }).join(', ')})`)
      const targetClient = await target.connect()
      await targetClient.query('BEGIN')
      try {
        const inserted = await targetClient.query(`
          INSERT INTO public.${quoteIdentifier(table)} (${quotedColumns.join(', ')})
          VALUES ${insertTuples.join(', ')} ON CONFLICT DO NOTHING
        `, values)
        result.inserted += inserted.rowCount ?? 0

        const keys = []
        const keyTuples = rows.rows.map((row) => `(${keyNames.map((key) => {
          keys.push(row[key])
          return `$${keys.length}`
        }).join(', ')})`)
        const saved = await targetClient.query(`
          SELECT ${quotedColumns.join(', ')} FROM public.${quoteIdentifier(table)}
          WHERE (${quotedKeys.join(', ')}) IN (${keyTuples.join(', ')})
        `, keys)
        const savedByKey = new Map(saved.rows.map((row) => [JSON.stringify(keyNames.map((key) => stableValue(row[key]))), row]))
        for (const sourceRow of rows.rows) {
          const key = JSON.stringify(keyNames.map((name) => stableValue(sourceRow[name])))
          const destinationRow = savedByKey.get(key)
          if (!destinationRow) throw new Error(`Missing destination row: ${table}`)
          if (!sameRow(sourceRow, destinationRow, columnNames)) throw new Error(`Conflicting destination row: ${table}`)
        }
        result.alreadyPresent += rows.rowCount - (inserted.rowCount ?? 0)
        await targetClient.query('COMMIT')
      } catch (error) {
        await targetClient.query('ROLLBACK').catch(() => undefined)
        result.rejected++
        throw error
      } finally {
        targetClient.release()
      }
      lastKey = keyNames.map((key) => rows.rows.at(-1)[key])
    }
  }

  const identityColumn = sourceShape.columns.find(({ is_identity }) => is_identity === 'YES')
  if (!invalidateSessions && identityColumn && keyNames.length === 1 && keyNames[0] === identityColumn.column_name) {
    const sequence = await target.query('SELECT pg_get_serial_sequence($1, $2) AS sequence', [`public.${table}`, identityColumn.column_name])
    if (sequence.rows[0]?.sequence) {
      await target.query(`
        SELECT setval($1::regclass,
          COALESCE((SELECT MAX(${quoteIdentifier(identityColumn.column_name)}) FROM public.${quoteIdentifier(table)}), 1),
          EXISTS (SELECT 1 FROM public.${quoteIdentifier(table)}))
      `, [sequence.rows[0].sequence])
    }
  }

  result.targetCountAfter = await countRows(target, table)
  result.verified = result.targetCountAfter === result.eligibleSourceCount
    && result.inserted + result.alreadyPresent === result.eligibleSourceCount
  if (!result.verified) throw new Error(`Count reconciliation failed: ${table}`)
  summary[table] = result
  await saveRun(target, 'in_progress', summary)
  return result
}

async function main() {
  validateConfiguration()
  const source = createPool(sourceUrl, process.env.SUPABASE_CA_CERT_FILE, process.env.SUPABASE_CA_CERT, true)
  const target = createPool(
    targetUrl,
    process.env.ADMIN_MIGRATION_SUPABASE_CA_CERT_FILE ?? process.env.ADMIN_SUPABASE_CA_CERT_FILE,
    process.env.ADMIN_MIGRATION_SUPABASE_CA_CERT ?? process.env.ADMIN_SUPABASE_CA_CERT,
    !execute,
  )

  try {
    const [sourceInfo, targetInfo] = await Promise.all([
      source.query('SELECT current_database() AS database_name, current_schema() AS schema_name'),
      target.query('SELECT current_database() AS database_name, current_schema() AS schema_name'),
    ])
    if (sourceInfo.rows[0].database_name !== decodeURIComponent(new URL(sourceUrl).pathname.slice(1))
      || targetInfo.rows[0].database_name !== decodeURIComponent(new URL(targetUrl).pathname.slice(1))
      || sourceInfo.rows[0].schema_name !== 'public' || targetInfo.rows[0].schema_name !== 'public') {
      throw new Error('Connected database identity mismatch.')
    }

    const targetTables = await target.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)
    const unexpected = targetTables.rows.map(({ tablename }) => tablename).filter((table) => !targetTableAllowlist.has(table))
    if (unexpected.length) throw new Error(`Unreviewed Admin target tables: ${unexpected.join(', ')}`)
    const ledger = await target.query(`SELECT to_regclass('public.admin_database_migration_runs') AS table_name`)
    if (!ledger.rows[0].table_name) throw new Error('Admin schema migrations have not been applied.')

    for (const table of adminTables) {
      const sourceShape = await getTableShape(source, table)
      const targetShape = await getTableShape(target, table)
      assertCompatibleShapes(table, sourceShape, targetShape)
    }

    const run = execute
      ? await beginOrResumeRun(target)
      : { startedAt: new Date(), summary: {} }
    const summary = run.summary
    const tables = {}
    for (const table of adminTables) {
      if (execute) tables[table] = await copyTable(source, target, table, summary)
      else {
        const sourceCount = await countRows(source, table)
        const targetCount = await countRows(target, table)
        tables[table] = {
          sourceCount,
          targetCount,
          eligibleSourceCount: sessionTables.has(table) ? 0 : sourceCount,
          invalidatedSessions: sessionTables.has(table) ? sourceCount : 0,
          schemaCompatible: true,
        }
      }
    }

    if (execute) await saveRun(target, 'completed', summary)
    console.info(JSON.stringify({ migrationId: runId, sourceIdentity, targetIdentity, mode: execute ? 'executed' : 'preflight_only', startedAt: run.startedAt, tables }))
  } catch {
    if (execute) {
      await target.query(`
        UPDATE public.admin_database_migration_runs
        SET status = 'failed', error_code = 'ADMIN_MIGRATION_FAILED', completed_at = NULL
        WHERE migration_id = $1
      `, [runId]).catch(() => undefined)
    }
    console.error(JSON.stringify({ migrationId: runId, sourceIdentity, targetIdentity, errorCode: execute ? 'ADMIN_MIGRATION_FAILED' : 'ADMIN_MIGRATION_PREFLIGHT_FAILED' }))
    process.exitCode = 1
  } finally {
    await Promise.all([source.end(), target.end()])
  }
}

main().catch(() => {
  console.error(JSON.stringify({ migrationId: runId, sourceIdentity, targetIdentity, errorCode: 'ADMIN_MIGRATION_FAILED' }))
  process.exitCode = 1
})
