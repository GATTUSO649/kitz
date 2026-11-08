import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspectMigration, parseSupabaseMigrationLedger } from './migration-audit.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const platformDir = path.resolve(scriptDir, '..')
const repositoryDir = path.resolve(platformDir, '..')
const defaultManifest = path.join(platformDir, 'migrations', 'marketplace-manifest.json')
const migrationIdPattern = /^\d{14}$/
const migrationFilenamePattern = /^(\d{14})_[a-z0-9][a-z0-9_-]*\.sql$/i

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ')
}

export function sha256(source) {
  return createHash('sha256').update(source).digest('hex')
}

function addError(errors, message) {
  errors.push(message)
}

export async function validateManifest(manifest, { root = repositoryDir, pendingIds = [] } = {}) {
  const errors = []
  const entries = manifest?.migrations
  if (manifest?.version !== 1 || !Array.isArray(entries)) {
    return { errors: ['Manifest must have version 1 and a migrations array.'], approvedPending: [], entries: [] }
  }

  const byId = new Map()
  const validatedEntries = []
  for (const [index, entry] of entries.entries()) {
    const label = `Manifest entry ${index + 1}`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      addError(errors, `${label} must be an object.`)
      continue
    }
    const { id, file, sha256: expectedHash, targetSchema, reviewStatus, approvalStatus, dependencies } = entry
    if (typeof id !== 'string' || !migrationIdPattern.test(id)) addError(errors, `${label} has an invalid 14-digit migration identifier.`)
    else if (byId.has(id)) addError(errors, `Duplicate migration identifier ${id}.`)
    else byId.set(id, entry)
    if (typeof file !== 'string' || !file.startsWith('supabase/migrations/') || file.includes('..') || path.isAbsolute(file)) {
      addError(errors, `${label} must reference a root Supabase migration file using a repository-relative path.`)
      continue
    }
    const filename = path.basename(file)
    const filenameMatch = migrationFilenamePattern.exec(filename)
    if (!filenameMatch || filenameMatch[1] !== id) addError(errors, `${label} file name must use its migration identifier.`)
    if (targetSchema !== 'marketplace') addError(errors, `${label} must declare targetSchema "marketplace".`)
    if (reviewStatus !== 'reviewed') addError(errors, `${label} has not passed review.`)
    if (approvalStatus !== 'approved') addError(errors, `${label} has not been explicitly approved.`)
    if (!['pending', 'applied'].includes(entry.executionStatus)) addError(errors, `${label} executionStatus must be pending or applied.`)
    if (entry.executionStatus === 'applied' && (typeof entry.executionEvidence !== 'string' || !entry.executionEvidence.trim())) {
      addError(errors, `${label} marked applied requires executionEvidence.`)
    }
    if (!Array.isArray(dependencies) || dependencies.some((dependency) => typeof dependency !== 'string' || !migrationIdPattern.test(dependency))) {
      addError(errors, `${label} dependencies must be an array of 14-digit migration identifiers.`)
    }
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
      addError(errors, `${label} has an invalid SHA-256 checksum.`)
    }

    const fullPath = path.resolve(root, file)
    if (!fullPath.startsWith(`${path.resolve(root)}${path.sep}`)) {
      addError(errors, `${label} file path escapes the repository.`)
      continue
    }
    let sql
    try {
      sql = await readFile(fullPath, 'utf8')
    } catch {
      addError(errors, `${label} migration file does not exist: ${file}.`)
      continue
    }
    if (typeof expectedHash === 'string' && /^[a-f0-9]{64}$/i.test(expectedHash) && sha256(sql) !== expectedHash.toLowerCase()) {
      addError(errors, `${label} checksum does not match ${file}.`)
    }

    const uncommented = stripComments(sql)
    const withoutStrings = uncommented.replace(/'(?:''|[^'])*'/g, "''")
    if (/\bpublic\b/i.test(withoutStrings)) {
      addError(errors, `${label} contains a public-schema reference.`)
    }
    if (/\b(?:search_path|EXECUTE\s+format|DO\s+\$)/i.test(withoutStrings)) {
      addError(errors, `${label} uses dynamic SQL or search_path behavior that cannot be safely scoped.`)
    }
    if (/\\[a-z]/i.test(withoutStrings)) addError(errors, `${label} contains a psql meta-command.`)
    if (/\b(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(withoutStrings)) addError(errors, `${label} contains transaction control; the executor manages its own transaction.`)
    const audit = inspectMigration(filename, sql)
    const statements = withoutStrings.split(';').map((statement) => statement.trim()).filter(Boolean)
    const supportedStatement = /^(?:CREATE\s+(?:(?:UNIQUE\s+)?INDEX|TABLE|SCHEMA|POLICY)\b|ALTER\s+(?:TABLE|POLICY)\b|DROP\s+(?:TABLE|POLICY)\b|TRUNCATE\b|GRANT\b|REVOKE\b|COMMENT\s+ON\b|INSERT\s+INTO\b|UPDATE\b|DELETE\s+FROM\b|MERGE\s+INTO\b|COPY\b)/i
    const dataStatements = statements.filter((statement) => /^(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|COPY)\b/i.test(statement))
    for (const statement of statements) {
      if (!supportedStatement.test(statement)) addError(errors, `${label} contains an unsupported SQL statement; manual review is required.`)
    }
    for (const statement of dataStatements) {
      if (!/^(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|COPY)\s+"?marketplace"?\s*\./i.test(statement)) {
        addError(errors, `${label} data-changing statements must explicitly target marketplace objects.`)
      }
    }
    if (audit.riskyOperations.length || dataStatements.length || statements.some((statement) => /^(?:GRANT|REVOKE)\b/i.test(statement))) {
      const approval = entry.destructiveApproval
      if (approval?.status !== 'approved' || typeof approval?.reference !== 'string' || !approval.reference.trim()) {
        addError(errors, `${label} contains risky or data-changing operations without explicit approval reference: ${audit.riskyOperations.join(', ') || 'data/permission change'}.`)
      }
    }
    const targetSchemas = new Set(audit.schemas)
    if (dataStatements.length) targetSchemas.add('marketplace')
    if (audit.targets.length + dataStatements.length === 0 || targetSchemas.size !== 1 || !targetSchemas.has('marketplace')) {
      addError(errors, `${label} is not provably confined to the marketplace schema.`)
    }

    validatedEntries.push({ ...entry, sql })
  }

  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !Array.isArray(entry.dependencies)) continue
    for (const dependency of entry.dependencies) {
      const dependencyEntry = byId.get(dependency)
      if (!dependencyEntry) addError(errors, `Migration ${entry.id} has unknown dependency ${dependency}.`)
      else if (dependency >= entry.id) addError(errors, `Migration ${entry.id} dependency ${dependency} must precede it.`)
      else if (dependencyEntry.reviewStatus !== 'reviewed' || dependencyEntry.approvalStatus !== 'approved') {
        addError(errors, `Migration ${entry.id} depends on migration ${dependency} that is not reviewed and approved.`)
      }
    }
  }

  const approvedIds = new Set(entries.filter((entry) => entry?.reviewStatus === 'reviewed' && entry?.approvalStatus === 'approved').map((entry) => entry.id))
  for (const pendingId of pendingIds) {
    if (!approvedIds.has(pendingId)) addError(errors, `Pending migration ${pendingId} is not explicitly approved in the MarketHub manifest.`)
  }
  const approvedPending = validatedEntries
    .filter((entry) => pendingIds.includes(entry.id) && entry.executionStatus === 'pending')
    .sort((left, right) => left.id.localeCompare(right.id))
  const plannedChanges = { createdTables: [], addedColumns: [] }
  for (const entry of approvedPending) {
    const statements = stripComments(entry.sql).split(';').map((statement) => statement.trim()).filter(Boolean)
    for (const statement of statements) {
      const createTable = statement.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?marketplace"?\s*\.\s*"?([a-z_][\w$]*)"?/i)
      if (createTable) plannedChanges.createdTables.push(createTable[1])
      const alterTable = statement.match(/^ALTER\s+TABLE\s+"?marketplace"?\s*\.\s*"?([a-z_][\w$]*)"?([\s\S]*)$/i)
      if (alterTable) {
        for (const column of alterTable[2].matchAll(/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][\w$]*)"?/gi)) {
          plannedChanges.addedColumns.push(`${alterTable[1]}.${column[1]}`)
        }
      }
    }
  }

  return {
    errors: [...new Set(errors)],
    approvedPending,
    entries: validatedEntries,
    plannedChanges: {
      createdTables: [...new Set(plannedChanges.createdTables)].sort(),
      addedColumns: [...new Set(plannedChanges.addedColumns)].sort(),
    },
  }
}

export function validateExecutionGate({ databaseUrl, approvalReference, backupVerified, backupReference }) {
  const errors = []
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) errors.push('MARKETPLACE_MIGRATION_DATABASE_URL is required.')
  if (typeof approvalReference !== 'string' || !approvalReference.trim()) errors.push('Production environment approval reference is required.')
  if (backupVerified !== 'true' || typeof backupReference !== 'string' || !backupReference.trim()) errors.push('Verified backup and recovery reference is required.')
  return errors
}

function getArgument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const manifestPath = path.resolve(getArgument('--manifest') ?? defaultManifest)
  const ledgerPath = getArgument('--ledger')
  const reportPath = getArgument('--report')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const ledgerText = ledgerPath ? await readFile(ledgerPath, 'utf8') : ''
  const ledgerRows = ledgerPath ? parseSupabaseMigrationLedger(ledgerText) : []
  const localIds = [...new Set(ledgerRows.map(({ local }) => local).filter(Boolean))]
  const remoteIds = new Set(ledgerRows.map(({ remote }) => remote).filter(Boolean))
  const pendingIds = localIds.filter((id) => !remoteIds.has(id))
  const result = await validateManifest(manifest, { pendingIds })
  const report = {
    checkedAt: new Date().toISOString(),
    manifest: path.relative(repositoryDir, manifestPath).replaceAll(path.sep, '/'),
    pendingMigrationIds: pendingIds,
    approvedPendingMigrationIds: result.approvedPending.map(({ id }) => id),
    plannedChanges: result.plannedChanges,
    errors: result.errors,
    valid: result.errors.length === 0,
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  if (reportPath) await writeFile(path.resolve(reportPath), serialized, 'utf8')
  process.stdout.write(serialized)
  if (result.errors.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`MarketHub migration manifest validation failed: ${error instanceof Error ? error.message : 'unknown failure'}\n`)
    process.exitCode = 1
  })
}