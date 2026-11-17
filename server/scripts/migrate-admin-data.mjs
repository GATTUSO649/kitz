import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { createPostgresSslOptions } from '../src/config/postgres-ssl.mjs'

const adminTables = [
  'admin_users',
  'admin_sessions',
  'admin_verification_tokens',
  'admin_audit_logs',
  'admin_setup_locks',
  'admin_permissions',
  'admin_role_permissions',
  'admin_user_permissions',
  'admin_invitations',
  'admin_login_attempts',
  'operations_users',
  'operations_sessions',
  'operations_operators',
  'operations_incidents',
  'operations_incident_events',
  'operations_audit_events',
  'monitoring_events',
  'monitoring_detection_rules',
  'monitoring_alerts',
  'monitoring_detection_history',
  'security_scans',
  'security_scan_modules',
  'security_findings',
  'security_finding_events',
  'security_scanner_health',
  'security_scan_schedules',
  'monitoring_worker_state',
]
const allowedTargetTables = new Set([
  ...adminTables,
  'admin_database_migration_runs',
  '__drizzle_admin_migrations',
])
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
    return project ? `supabase:${project.toLowerCase()}` : `${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname}`
  } catch {
    return null
  }
}

function areSameDatabaseTarget(first, second) {
  const firstIdentity = databaseTargetIdentity(first)
  const secondIdentity = databaseTargetIdentity(second)
  return firstIdentity !== null && firstIdentity === secondIdentity
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) throw new Error('Unexpected database identifier.')
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
  if (databaseTargetIdentity(runtimeAdminUrl) !== targetIdentity) throw new Error('ADMIN_DATABASE_URL and the migration target do not identify the same Admin project.')
  if (areSameDatabaseTarget(sourceUrl, targetUrl)) throw new Error('Kitz source and Admin migration target must be separate projects.')
  if (process.env.ADMIN_MIGRATION_APPROVED !== 'YES'
    || process.env.ADMIN_BACKUP_VERIFIED !== 'YES'
    || process.env.ADMIN_STAGING_VERIFIED !== 'YES') {
    throw new Error('Migration requires explicit approval, a verified backup, and successful staging verification.')
  }
  if (execute && process.env.ADMIN_MIGRATION_EXECUTE !== 'YES') {
    throw new Error('Set ADMIN_MIGRATION_EXECUTE=YES for the explicitly approved data-copy run.')
  }
  if (!execute) console.info('Read-only Admin data migration preflight; no rows will be copied.')
}

function makePool(connectionString, caFile, caContents, readOnly = false) {
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
           is_identity, identity_generation, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [table])
  if (!columns.rowCount) throw new Error(`Required table ${table} is missing.`)

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
  if (!primaryKey.rowCount) throw new Error(`Required primary key for ${table} is missing.`)
  return { columns: columns.rows, primaryKey: primaryKey.rows.map(({ column_name }) => column_name) }
}

function assertCompatibleShapes(table, sourceShape, targetShape) {
  const normalize = (shape) => shape.columns.map((column) => JSON.stringify(column)).join('|')
  if (normalize(sourceShape) !== normalize(targetShape)
    || JSON.stringify(sourceShape.primaryKey) !== JSON.stringify(targetShape.primaryKey)) {
    throw new Error(`Source and Admin table definitions differ for ${table}.`)
  }
}

async function getRun(target, sourceId, targetId) {
  const existing = await target.query(`
    SELECT migration_id, source_identity, target_identity, status, summary, started_at
    FROM public.admin_database_migration_runs
    WHERE migration_id = $1
  `, [runId])
  if (existing.rowCount) {
    const run = existing.rows[0]
    if (run.source_identity !== sourceId || run.target_identity !== targetId) {
      throw new Error('The saved migration run is bound to different database identities.')
    }
    if (run.status === 'completed') throw new Error('This migration run is already complete; use a new run ID for a separately reviewed reconciliation.')
    await target.query(`
      UPDATE public.admin_database_migration_runs
      SET status = 'in_progress', error_code = NULL
      WHERE migration_id = $1
    `, [runId])
    return { startedAt: run.started_at, summary: run.summary ?? {} }
  }
  const created = await target.query(`
    INSERT INTO public.admin_database_migration_runs
      (migration_id, source_identity, target_identity, status, summary)
    VALUES ($1, $2, $3, 'in_progress', '{}'::jsonb)
    RETURNING started_at
  `, [runId, sourceId, targetId])
  return { startedAt: created.rows[0].started_at, summary: {} }
}

async function saveRun(target, status, summary, errorCode = null) {
  await target.query(`
    UPDATE public.admin_database_migration_runs
    SET status = $2, summary = $3::jsonb, error_code = $4,
        completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END
    WHERE migration_id = $1
  `, [runId, status, JSON.stringify(summary), errorCode])
}

async function countRows(client, table) {
  const result = await client.query(`SELECT count(*)::text AS count FROM public.${quoteIdentifier(table)}`)
  return Number(result.rows[0].count)
}

async function copyTable(source, target, table, cutoff, executeCopy, summary) {
  const sourceShape = await getTableShape(source, table)
  const targetShape = await getTableShape(target, table)
  assertCompatibleShapes(table, sourceShape, targetShape)

  const columnNames = sourceShape.columns.map(({ column_name }) => column_name)
  const keyNames = sourceShape.primaryKey
  const quotedColumns = columnNames.map(quoteIdentifier)
  const quotedKeys = keyNames.map(quoteIdentifier)
  const sourceCount = await countRows(source, table)
  const targetCountBefore = await countRows(target, table)
  const sessionTable = table === 'admin_sessions' || table === 'operations_sessions'
  const invalidatedSessions = sessionTable
    ? Number((await source.query(`SELECT count(*)::text AS count FROM public.${quoteIdentifier(table)} WHERE expires_at > $1`, [cutoff])).rows[0].count)
    : 0
  const eligibleSourceCount = sourceCount - invalidatedSessions
  const result = {
    sourceCount,
    eligibleSourceCount,
    invalidatedSessions,
    inserted: 0,
    alreadyPresent: 0,
    rejected: 0,
    targetCountBefore,
    targetCountAfter: targetCountBefore,
    verified: false,
  }
  if (!executeCopy) return result

  let lastKey = null
  while (true) {
    const parameters = []
    const filters = []
    if (sessionTable) {
      parameters.push(cutoff)
      filters.push(`expires_at <= $${parameters.length}`)
    }
    if (lastKey) {
      const keyTuple = `(${quotedKeys.join(', ')})`
      const valueTuple = `(${lastKey.map((value) => {
        parameters.push(value)
        return `$${parameters.length}`
      }).join(', ')})`
      filters.push(`${keyTuple} > ${valueTuple}`)
    }
    parameters.push(batchSize)
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const batch = await source.query(`
      SELECT ${quotedColumns.join(', ')}
      FROM public.${quoteIdentifier(table)}
      ${where}
      ORDER BY ${quotedKeys.join(', ')}
      LIMIT $${parameters.length}
    `, parameters)
    if (!batch.rowCount) break

    const values = []
    const tuples = batch.rows.map((row) => `(${columnNames.map((column) => {
      values.push(row[column])
      return `$${values.length}`
    }).join(', ')})`)
    const tupleKeys = batch.rows.map((row) => keyNames.map((key) => row[key]))
    const targetClient = await target.connect()
    await targetClient.query('BEGIN')
    try {
      const inserted = await targetClient.query(`
        INSERT INTO public.${quoteIdentifier(table)} (${quotedColumns.join(', ')})
        VALUES ${tuples.join(', ')}
        ON CONFLICT DO NOTHING
      `, values)
      result.inserted += inserted.rowCount ?? 0

      const keyValues = []
      const targetKeyTuples = tupleKeys.map((key) => `(${key.map((value) => {
        keyValues.push(value)
        return `$${keyValues.length}`
      }).join(', ')})`)
      const copiedRows = await targetClient.query(`
        SELECT ${quotedColumns.join(', ')}
        FROM public.${quoteIdentifier(table)}
        WHERE (${quotedKeys.join(', ')}) IN (${targetKeyTuples.join(', ')})
      `, keyValues)
      const copiedByKey = new Map(copiedRows.rows.map((row) => [JSON.stringify(keyNames.map((key) => stableValue(row[key]))), row]))
      for (const sourceRow of batch.rows) {
        const key = JSON.stringify(keyNames.map((key) => stableValue(sourceRow[key])))
        const targetRow = copiedByKey.get(key)
        if (!targetRow) {
          result.rejected++
          throw new Error(`A source row could not be reconciled in ${table}.`)
        }
        if (!sameRow(sourceRow, targetRow, columnNames)) {
          result.rejected++
          throw new Error(`A conflicting destination row was found in ${table}.`)
        }
      }
      result.alreadyPresent += batch.rowCount - (inserted.rowCount ?? 0)
      await targetClient.query('COMMIT')
    } catch (error) {
      await targetClient.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      targetClient.release()
    }
    lastKey = keyNames.map((key) => batch.rows.at(-1)[key])
  }

  const identityColumn = sourceShape.columns.find(({ is_identity }) => is_identity === 'YES')
  if (identityColumn && keyNames.length === 1 && keyNames[0] === identityColumn.column_name) {
    const sequence = await target.query(`SELECT pg_get_serial_sequence($1, $2) AS sequence`, [`public.${table}`, identityColumn.column_name])
    if (sequence.rows[0]?.sequence) {
      await target.query(`
        SELECT setval($1::regclass,
          COALESCE((SELECT MAX(${quoteIdentifier(identityColumn.column_name)}) FROM public.${quoteIdentifier(table)}), 1),
          EXISTS (SELECT 1 FROM public.${quoteIdentifier(table)}))
      `, [sequence.rows[0].sequence])
    }
  }

  result.targetCountAfter = await countRows(target, table)
  result.verified = result.inserted + result.alreadyPresent === result.eligibleSourceCount
    && result.targetCountAfter === result.eligibleSourceCount
  if (!result.verified) throw new Error(`Row-count reconciliation failed for ${table}.`)
  summary[table] = result
  await saveRun(target, 'in_progress', summary)
  return result
}

async function main() {
  validateConfiguration()
  const source = makePool(sourceUrl, process.env.SUPABASE_CA_CERT_FILE, process.env.SUPABASE_CA_CERT, true)
  const target = makePool(
    targetUrl,
    process.env.ADMIN_MIGRATION_SUPABASE_CA_CERT_FILE ?? process.env.ADMIN_SUPABASE_CA_CERT_FILE,
    process.env.ADMIN_MIGRATION_SUPABASE_CA_CERT ?? process.env.ADMIN_SUPABASE_CA_CERT,
  )

  try {
    const [sourceIdentityCheck, targetIdentityCheck] = await Promise.all([
      source.query('SELECT current_database() AS database_name, current_user AS role_name, current_schema() AS schema_name'),
      target.query('SELECT current_database() AS database_name, current_user AS role_name, current_schema() AS schema_name'),
    ])
    if (sourceIdentityCheck.rows[0].database_name !== new URL(sourceUrl).pathname.slice(1)
      || targetIdentityCheck.rows[0].database_name !== new URL(targetUrl).pathname.slice(1)
      || sourceIdentityCheck.rows[0].schema_name !== 'public'
      || targetIdentityCheck.rows[0].schema_name !== 'public') {
      throw new Error('Connected database names do not match the reviewed URLs.')
    }

    const targetTables = await target.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `)
    const unexpectedTables = targetTables.rows
      .map(({ tablename }) => tablename)
      .filter((table) => !allowedTargetTables.has(table))
    if (unexpectedTables.length) {
      throw new Error(`Unexpected public tables exist in the Admin target: ${unexpectedTables.join(', ')}.`)
    }

    const ledger = await target.query(`
      SELECT to_regclass('public.admin_database_migration_runs') AS table_name
    `)
    if (!ledger.rows[0].table_name) throw new Error('Apply the reviewed Admin schema migrations before starting data transfer.')

    const shapes = await Promise.all(adminTables.map(async (table) => ({
      table,
      source: await getTableShape(source, table),
      target: await getTableShape(target, table),
    })))
    for (const { table, source: sourceShape, target: targetShape } of shapes) assertCompatibleShapes(table, sourceShape, targetShape)

    const cutoff = new Date()
    const run = execute
      ? await getRun(target, sourceIdentity, targetIdentity)
      : { startedAt: cutoff, summary: {} }
    const startedAt = new Date(run.startedAt)
    const summary = run.summary ?? {}
    const tables = {}
    for (const table of adminTables) {
      tables[table] = await copyTable(source, target, table, cutoff, execute, summary)
    }

    const report = {
      migrationId: runId,
      sourceIdentity,
      targetIdentity,
      mode: execute ? 'executed' : 'preflight_only',
      startedAt: startedAt.toISOString(),
      tables,
    }
    if (execute) await saveRun(target, 'completed', { ...summary, ...tables })
    console.info(JSON.stringify(report))
  } catch (error) {
    if (execute) {
      const message = error instanceof Error ? error.message : ''
      const safeCode = /missing|differ|conflict|reconcil|primary key|identity|permission|role/i.test(message)
        ? 'ADMIN_MIGRATION_VALIDATION_FAILED'
        : 'ADMIN_MIGRATION_FAILED'
      await target.query(`
        UPDATE public.admin_database_migration_runs
        SET status = 'failed', error_code = $2, completed_at = NULL
        WHERE migration_id = $1
      `, [runId, safeCode]).catch(() => undefined)
      console.error(JSON.stringify({ migrationId: runId, sourceIdentity, targetIdentity, errorCode: safeCode }))
    } else {
      console.error(JSON.stringify({ migrationId: runId, sourceIdentity, targetIdentity, errorCode: 'ADMIN_MIGRATION_PREFLIGHT_FAILED' }))
    }
    process.exitCode = 1
  } finally {
    await Promise.all([source.end(), target.end()])
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Admin data migration failed.')
  process.exitCode = 1
})
