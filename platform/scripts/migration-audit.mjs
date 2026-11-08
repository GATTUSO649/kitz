import { execFileSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const platformDir = path.resolve(scriptDir, '..')
const repositoryDir = path.resolve(platformDir, '..')
const supabaseMigrationsDir = path.join(repositoryDir, 'supabase', 'migrations')
const marketplaceMigrationsDir = path.join(platformDir, 'server', 'src', 'database', 'marketplace-migrations')
const migrationNamePattern = /^(\d{14})_([a-z0-9][a-z0-9_-]*)\.sql$/i

const destructivePatterns = [
  ['DROP', /\bDROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN|INDEX|TYPE|SEQUENCE|FUNCTION|POLICY|CONSTRAINT)\b/i],
  ['ALTER_POLICY', /\bALTER\s+POLICY\b/i],
  ['TRUNCATE', /\bTRUNCATE\b/i],
  ['DELETE', /\bDELETE\s+FROM\b/i],
  ['DISABLE_RLS', /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i],
  ['REMOVE_FORCE_RLS', /\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b/i],
  ['REVOKE', /\bREVOKE\b/i],
]

function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, ' ')
}

function extractObjectTargets(sql) {
  const targets = []
  const identifier = '(?:"[^"\n]+"|[a-zA-Z_][a-zA-Z0-9_$]*)'
  const qualifiedIdentifier = `${identifier}(?:\\s*\\.\\s*${identifier})?`
  const patterns = [
    new RegExp(`\\b(?:CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE|ALTER\\s+TABLE|DROP\\s+TABLE|TRUNCATE\\s+(?:TABLE\\s+)?)(?:\\s+IF\\s+(?:NOT\\s+)?EXISTS)?\\s+(${qualifiedIdentifier})`, 'gi'),
    new RegExp(`\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${identifier}\\s+ON\\s+(${qualifiedIdentifier})`, 'gi'),
    new RegExp(`\\bCREATE\\s+POLICY\\s+${identifier}\\s+ON\\s+(${qualifiedIdentifier})`, 'gi'),
    new RegExp(`\\bALTER\\s+POLICY\\s+${identifier}\\s+ON\\s+(${qualifiedIdentifier})`, 'gi'),
    new RegExp(`\\bREFERENCES\\s+(${qualifiedIdentifier})`, 'gi'),
    new RegExp(`\\bGRANT\\s+[\\s\\S]{1,120}?\\s+ON\\s+(?:TABLE\\s+)?(${qualifiedIdentifier})`, 'gi'),
  ]

  for (const pattern of patterns) {
    for (const match of sql.matchAll(pattern)) {
      const target = match[1]?.trim()
      if (!target) continue
      if (target.toLowerCase() === 'public' && /\bpublic\s*\.\s*%I/i.test(sql)) continue
      const parts = target.split(/\s*\.\s*/).map((part) => part.replace(/^"|"$/g, ''))
      targets.push({ schema: parts.length > 1 ? parts[0] : 'public (unqualified)', name: parts.at(-1) })
    }
  }

  for (const match of sql.matchAll(/\bCREATE\s+SCHEMA(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_$]*))/gi)) {
    targets.push({ schema: match[1] ?? match[2], name: '(schema)' })
  }
  if (/\bEXECUTE\s+format\s*\([\s\S]{0,400}?\bpublic\s*\./i.test(sql)) {
    targets.push({ schema: 'public (dynamic)', name: '(dynamic SQL)' })
  }
  return [...new Map(targets.map((target) => [`${target.schema}.${target.name}`, target])).values()]
}

export function inspectMigration(name, sql) {
  const cleaned = stripComments(sql)
  const targets = extractObjectTargets(cleaned)
  const riskyOperations = destructivePatterns.filter(([, pattern]) => pattern.test(cleaned)).map(([name]) => name)
  return {
    name,
    targets,
    schemas: [...new Set(targets.map(({ schema }) => schema))].sort(),
    tableCreates: [...cleaned.matchAll(/\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"marketplace"\s*\.\s*)?"?(marketplace_[a-z0-9_]+)"?/gi)].map((match) => match[1]),
    indexes: (cleaned.match(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/gi) ?? []).length,
    constraints: (cleaned.match(/\bADD\s+CONSTRAINT\b/gi) ?? []).length,
    foreignKeys: (cleaned.match(/\bFOREIGN\s+KEY\b/gi) ?? []).length,
    policies: (cleaned.match(/\bCREATE\s+POLICY\b/gi) ?? []).length,
    enablesRls: (cleaned.match(/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/gi) ?? []).length,
    forcesRls: (cleaned.match(/\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/gi) ?? []).length,
    disablesRls: (cleaned.match(/\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/gi) ?? []).length,
    riskyOperations,
    hasPublicPolicy: /\bCREATE\s+POLICY\b[\s\S]{0,300}?\bTO\s+(?:PUBLIC|anon|authenticated)\b[\s\S]{0,300}?\bUSING\s*\(\s*true\s*\)/i.test(cleaned),
  }
}

export function parseSupabaseMigrationLedger(output) {
  const rows = []
  for (const line of output.split(/\r?\n/)) {
    const columns = line.split(/[│|]/).map((column) => column.trim())
    if (columns.length < 2) continue
    const local = columns[0].match(/\b\d{14}\b/)?.[0] ?? null
    const remote = columns[1].match(/\b\d{14}\b/)?.[0] ?? null
    if (local || remote) rows.push({ local, remote })
  }
  return rows
}

async function listSqlFiles(directory) {
  let names
  try {
    names = await readdir(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  return names.filter((name) => name.endsWith('.sql')).sort().map((name) => path.join(directory, name))
}

function readChangedFiles(listPath, base, head) {
  if (listPath) return readFile(listPath, 'utf8').then((text) => text.split(/\r?\n/).filter(Boolean))
  if (base && head && !/^0+$/.test(base)) {
    try {
      return Promise.resolve(execFileSync('git', ['diff', '--name-only', `${base}...${head}`, '--', 'supabase/migrations'], { cwd: repositoryDir, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean))
    } catch {
      return Promise.resolve([])
    }
  }
  return Promise.resolve([])
}

function parseTableSet(source, expression) {
  return [...source.matchAll(expression)].map((match) => match[1]).sort()
}

async function buildReport({ strictMarketplace = false, changedList, base, head } = {}) {
  const problems = []
  const warnings = []
  const records = []
  let pendingVersions = null
  let remoteOnlyVersions = null
  const migrationFiles = await listSqlFiles(supabaseMigrationsDir)
  const identifiers = new Map()

  for (const file of migrationFiles) {
    const name = path.basename(file)
    const match = migrationNamePattern.exec(name)
    if (!match) {
      problems.push(`Invalid Supabase migration filename: ${name}`)
      continue
    }
    const [, version] = match
    if (identifiers.has(version)) problems.push(`Duplicate migration identifier ${version}: ${identifiers.get(version)} and ${name}`)
    identifiers.set(version, name)
    const sql = await readFile(file, 'utf8')
    records.push({ version, ...inspectMigration(name, sql) })
  }

  const versions = records.map(({ version }) => version)
  if (versions.some((version, index) => index > 0 && version <= versions[index - 1])) {
    problems.push('Supabase migration identifiers are not strictly increasing in filename order.')
  }

  const changedPaths = await readChangedFiles(changedList, base, head)
  const changedMigrations = records.filter(({ name }) => changedPaths.some((changedPath) => path.basename(changedPath) === name))
  for (const changedPath of changedPaths) {
    if (!changedPath.endsWith('.sql')) continue
    const record = changedMigrations.find(({ name }) => name === path.basename(changedPath))
    if (!record) {
      problems.push(`Changed SQL migration was not found in the repository: ${changedPath}`)
      continue
    }
    if (!record.schemas.length || record.schemas.some((schema) => schema !== 'marketplace')) {
      problems.push(`MarketHub migration ${record.name} is not provably confined to the marketplace schema (targets: ${record.schemas.join(', ') || 'unqualified SQL'}).`)
    }
    if (record.riskyOperations.length) {
      problems.push(`MarketHub migration ${record.name} contains unsafe operations requiring a separate reviewed manual release: ${record.riskyOperations.join(', ')}.`)
    }
    if (record.disablesRls || record.hasPublicPolicy) {
      problems.push(`MarketHub migration ${record.name} weakens row-level security or grants an unconditional public policy.`)
    }
  }

  const schemaSource = await readFile(path.join(platformDir, 'server', 'src', 'database', 'schema.ts'), 'utf8')
  const appSource = await readFile(path.join(platformDir, 'server', 'src', 'app.ts'), 'utf8')
  const declaredTables = parseTableSet(schemaSource, /marketplaceSchema\.table\(\s*['"]([^'"]+)['"]/g)
  const requiredBlock = appSource.match(/WITH required_tables\(name\) AS \(VALUES([\s\S]*?)\), required_privileges\(name, privilege\)/)?.[1] ?? ''
  const healthTables = parseTableSet(requiredBlock, /\('([^']+)'\)/g)
  const missingHealthTables = declaredTables.filter((table) => !healthTables.includes(table))
  const unknownHealthTables = healthTables.filter((table) => !declaredTables.includes(table))
  if (missingHealthTables.length || unknownHealthTables.length) {
    problems.push(`Application schema and /health/ready table expectations differ; missing from health: ${missingHealthTables.join(', ') || 'none'}; unknown to schema: ${unknownHealthTables.join(', ') || 'none'}.`)
  }

  const drizzleFiles = await listSqlFiles(path.join(marketplaceMigrationsDir))
  const drizzleTables = new Set()
  for (const file of drizzleFiles) {
    const source = stripComments(await readFile(file, 'utf8'))
    for (const match of source.matchAll(/\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"marketplace"\s*\.\s*)?"?(marketplace_[a-z0-9_]+)"?/gi)) drizzleTables.add(match[1])
  }
  const missingDrizzleTables = declaredTables.filter((table) => !drizzleTables.has(table))
  if (missingDrizzleTables.length) problems.push(`MarketHub Drizzle migration history does not create expected tables: ${missingDrizzleTables.join(', ')}.`)

  const supabaseMarketplaceCreates = new Set(records.flatMap(({ tableCreates }) => tableCreates))
  const missingSupabaseTables = declaredTables.filter((table) => !supabaseMarketplaceCreates.has(table))
  if (missingSupabaseTables.length) {
    const message = `Supabase migration history does not define the Marketplace schema baseline for ${missingSupabaseTables.length} expected tables.`
    if (strictMarketplace) problems.push(message)
    else warnings.push(`${message} Production migration/deployment must remain blocked until the ledger and schema are reconciled.`)
  }

  let ledgerRows = []
  const ledgerPath = process.argv.includes('--ledger') ? process.argv[process.argv.indexOf('--ledger') + 1] : undefined
  if (ledgerPath) {
    ledgerRows = parseSupabaseMigrationLedger(await readFile(ledgerPath, 'utf8'))
    if (!ledgerRows.length) problems.push('Supabase CLI migration-list output contained no parseable local/remote versions; refusing to infer a deployment plan.')
    const localVersions = new Set(ledgerRows.map(({ local }) => local).filter(Boolean))
    const remoteVersions = new Set(ledgerRows.map(({ remote }) => remote).filter(Boolean))
    pendingVersions = [...localVersions].filter((version) => !remoteVersions.has(version)).sort()
    remoteOnlyVersions = [...remoteVersions].filter((version) => !localVersions.has(version)).sort()
    if (remoteOnlyVersions.length) problems.push(`Remote migration versions are missing from the repository: ${remoteOnlyVersions.join(', ')}.`)
    for (const version of pendingVersions) {
      const record = records.find((item) => item.version === version)
      if (!record) {
        problems.push(`Pending migration ${version} has no audited SQL file.`)
        continue
      }
      if (strictMarketplace && (record.schemas.length !== 1 || record.schemas[0] !== 'marketplace')) {
        problems.push(`Pending migration ${record.name} targets ${record.schemas.join(', ') || 'unknown'}; Supabase db push would include non-MarketHub SQL.`)
      }
      if (strictMarketplace && record.riskyOperations.length) {
        problems.push(`Pending migration ${record.name} contains operations requiring a separately reviewed manual procedure: ${record.riskyOperations.join(', ')}.`)
      }
    }
    if (strictMarketplace && pendingVersions.length === 0) warnings.push('No local migrations are pending on the remote ledger.')
  } else if (strictMarketplace) {
    problems.push('Strict release audit requires captured `supabase migration list` output from the target database.')
  }

  const config = await readFile(path.join(repositoryDir, 'supabase', 'config.toml'), 'utf8')
  const apiSchemas = config.match(/schemas\s*=\s*\[([^\]]*)\]/)?.[1] ?? ''
  const marketplaceApiExposed = /['"]marketplace['"]/.test(apiSchemas)
  const autoExposeNewTables = /auto_expose_new_tables\s*=\s*true/i.test(config)
  if (marketplaceApiExposed || autoExposeNewTables) {
    problems.push('Supabase Data API exposure is not isolated: marketplace must remain outside API schemas and auto_expose_new_tables must remain false.')
  }

  const migrationSummary = records.map((record) => ({
    version: record.version,
    name: record.name,
    schemas: record.schemas,
    targets: record.targets,
    tableCreates: record.tableCreates,
    indexes: record.indexes,
    constraints: record.constraints,
    foreignKeys: record.foreignKeys,
    policies: record.policies,
    enablesRls: record.enablesRls,
    forcesRls: record.forcesRls,
    disablesRls: record.disablesRls,
    riskyOperations: record.riskyOperations,
  }))

  const lines = [
    '# MarketHub Migration Audit',
    '',
    `- Commit: ${head ?? process.env.GITHUB_SHA ?? 'local'}`,
    `- Supabase migrations discovered: ${records.length}`,
    `- Changed Supabase migrations audited for marketplace-only scope: ${changedMigrations.length}`,
    `- Expected Marketplace tables in Drizzle schema: ${declaredTables.length}`,
    `- Tables represented in Supabase migrations: ${supabaseMarketplaceCreates.size}`,
    `- Pending migrations: ${pendingVersions?.join(', ') || 'unknown (no ledger supplied)'}`,
    `- Remote-only migrations: ${remoteOnlyVersions?.join(', ') || 'none reported'}`,
    `- Supabase Data API exposes marketplace: ${marketplaceApiExposed ? 'yes (blocked)' : 'no'}`,
    `- New public tables auto-exposed: ${autoExposeNewTables ? 'yes (blocked)' : 'no'}`,
    '',
    '## Migration inventory',
    '',
    '| Version | File | Target schemas | Affected objects | Marketplace table creates | Indexes | Constraints | FKs | Policies | RLS enables | Destructive/risky operations |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---:|---|',
    ...migrationSummary.map((record) => `| ${record.version} | ${record.name} | ${record.schemas.join(', ') || 'unknown'} | ${record.targets.map(({ schema, name }) => `${schema}.${name}`).join('<br>') || 'unknown'} | ${record.tableCreates.length} | ${record.indexes} | ${record.constraints} | ${record.foreignKeys} | ${record.policies} | ${record.enablesRls} | ${record.riskyOperations.join(', ') || 'none'} |`),
    '',
    '## Assessment',
    '',
    ...(warnings.length ? warnings.map((warning) => `- WARNING: ${warning}`) : ['- No migration parity warnings.']),
    ...(problems.length ? problems.map((problem) => `- BLOCKER: ${problem}`) : ['- No static blockers detected.']),
    '',
    'This static audit does not apply or approve migrations. Remote identity, migration ledger, permissions, backup readiness, catalog checks, and human approval are separate release gates.',
  ]
  return { problems, warnings, markdown: `${lines.join('\n')}\n`, migrationSummary, pendingVersions, remoteOnlyVersions }
}

async function main() {
  const args = process.argv.slice(2)
  const valueAfter = (name) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const reportPath = valueAfter('--report')
  const jsonReportPath = valueAfter('--json-report')
  const result = await buildReport({
    strictMarketplace: args.includes('--strict-marketplace'),
    changedList: valueAfter('--changed-list'),
    base: valueAfter('--base') ?? process.env.MARKETHUB_BASE_SHA,
    head: valueAfter('--head') ?? process.env.MARKETHUB_HEAD_SHA,
  })
  process.stdout.write(result.markdown)
  if (reportPath) await writeFile(reportPath, result.markdown, 'utf8')
  if (jsonReportPath) await writeFile(jsonReportPath, `${JSON.stringify({
    commit: valueAfter('--head') ?? process.env.GITHUB_SHA ?? 'local',
    migrationCount: result.migrationSummary.length,
    pendingVersions: result.pendingVersions ?? [],
    remoteOnlyVersions: result.remoteOnlyVersions ?? [],
    problems: result.problems,
    warnings: result.warnings,
    migrationSummary: result.migrationSummary,
  }, null, 2)}\n`, 'utf8')
  if (result.problems.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Migration audit failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    process.exitCode = 1
  })
}