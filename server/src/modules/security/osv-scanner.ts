import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { discoverNpmAuditTargets, classifySeverity, type DependencyFinding } from './dependency-scanner.js'

const osvEndpoint = 'https://api.osv.dev/v1/querybatch'
const batchSize = 500
const maximumPackages = 50_000

type LockedPackage = { name?: string; version?: string; dev?: boolean }
type PackageLock = { packages?: Record<string, LockedPackage> }
type OsvVulnerability = {
  id: string
  aliases?: string[]
  summary?: string
  details?: string
  severity?: { type?: string; score?: string }[]
  affected?: { package?: { name?: string; ecosystem?: string }; ranges?: { events?: { fixed?: string }[] }[]; database_specific?: { severity?: string; cwe_ids?: string[] } }[]
  database_specific?: { severity?: string; cwe_ids?: string[] }
}
type OsvResponse = { results?: { vulns?: OsvVulnerability[] }[] }

type OsvOptions = {
  cwd: string
  signal?: AbortSignal
  fetcher?: typeof fetch
  endpoint?: string
}

function readInventory(cwd: string) {
  const targets = discoverNpmAuditTargets(cwd)
  if (!targets.length) throw new Error('OSV_LOCKFILES_NOT_FOUND')
  const packages = new Map<string, { name: string; version: string; project: string; direct: boolean }>()
  for (const target of targets) {
    const lock = JSON.parse(readFileSync(target.lockfile, 'utf8')) as PackageLock
    const lockedPackages = lock.packages ?? {}
    const rootDependencies = new Set(Object.keys(lockedPackages['']?.name ? {} : (JSON.parse(readFileSync(target.lockfile, 'utf8')) as { packages?: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> }).packages?.['']?.dependencies ?? {}))
    const rootDevDependencies = new Set(Object.keys((JSON.parse(readFileSync(target.lockfile, 'utf8')) as { packages?: Record<string, { devDependencies?: Record<string, string> }> }).packages?.['']?.devDependencies ?? {}))
    const project = relative(cwd, target.root).replaceAll('\\', '/') || '.'
    for (const [path, dependency] of Object.entries(lockedPackages)) {
      if (!path || !dependency.name || !dependency.version || dependency.name.startsWith('file:')) continue
      const key = `${dependency.name}\0${dependency.version}\0${project}`
      packages.set(key, {
        name: dependency.name,
        version: dependency.version,
        project,
        direct: rootDependencies.has(dependency.name) || rootDevDependencies.has(dependency.name),
      })
      if (packages.size >= maximumPackages) break
    }
  }
  return [...packages.values()]
}

function severity(vulnerability: OsvVulnerability) {
  const values = [vulnerability.database_specific?.severity, ...((vulnerability.affected ?? []).map((item) => item.database_specific?.severity))]
  for (const value of values) {
    const classified = classifySeverity(value)
    if (classified) return classified
  }
  return null
}

function vulnerabilityFinding(packageInfo: { name: string; version: string; project: string; direct: boolean }, vulnerability: OsvVulnerability): DependencyFinding {
  const advisoryId = vulnerability.id.slice(0, 100)
  const fixedVersions = [...new Set((vulnerability.affected ?? []).flatMap((affected) => (affected.ranges ?? []).flatMap((range) => (range.events ?? []).flatMap((event) => event.fixed ? [event.fixed] : []))))]
  const aliases = vulnerability.aliases ?? []
  const cve = aliases.filter((alias) => /^CVE-\d{4}-\d+$/i.test(alias)).slice(0, 5)
  const cwe = [...new Set([...(vulnerability.database_specific?.cwe_ids ?? []), ...(vulnerability.affected ?? []).flatMap((affected) => affected.database_specific?.cwe_ids ?? [])])].slice(0, 10)
  const fingerprint = createHash('sha256').update(`${packageInfo.project}\0${packageInfo.name}\0${packageInfo.version}\0${advisoryId}`).digest('hex').slice(0, 24)
  const projectPath = packageInfo.project === '.' ? '' : `${packageInfo.project}/`
  return {
    id: randomUUID(),
    scanner: 'osv',
    title: `${advisoryId}: ${vulnerability.summary ?? `${packageInfo.name} vulnerability`}`.slice(0, 240),
    description: (vulnerability.summary ?? vulnerability.details ?? `OSV reported ${advisoryId} for ${packageInfo.name}@${packageInfo.version}.`).slice(0, 2000),
    severity: severity(vulnerability),
    cve,
    cwe,
    affectedComponent: `${packageInfo.name}@${packageInfo.version}`,
    affectedFile: `${projectPath}package-lock.json`,
    evidence: {
      advisoryId,
      package: packageInfo.name,
      installedVersion: packageInfo.version,
      ecosystem: 'npm',
      directDependency: packageInfo.direct,
      project: packageInfo.project,
      fixedVersions: fixedVersions.slice(0, 20).join(', ') || null,
      advisoryUrl: `https://osv.dev/vulnerability/${encodeURIComponent(advisoryId)}`,
    },
    remediation: fixedVersions.length
      ? `Review OSV advisory ${advisoryId} and upgrade ${packageInfo.name} to a compatible fixed version: ${fixedVersions.join(', ')}.`
      : `Review OSV advisory ${advisoryId}; no fixed version was reported in the lockfile query.`,
    deduplicationKey: `${packageInfo.project}:${packageInfo.name}@${packageInfo.version}:${advisoryId}:${fingerprint}`,
    lifecycleStatus: 'OPEN',
    verificationStatus: 'UNVERIFIED',
  }
}

export async function runOsvScanner(options: OsvOptions) {
  const inventory = readInventory(options.cwd)
  if (!inventory.length) throw new Error('OSV_PACKAGE_INVENTORY_EMPTY')
  const fetcher = options.fetcher ?? fetch
  const findings: DependencyFinding[] = []
  let queriedPackages = 0
  for (let offset = 0; offset < inventory.length; offset += batchSize) {
    if (options.signal?.aborted) throw new Error('OSV_SCAN_CANCELLED')
    const batch = inventory.slice(offset, offset + batchSize)
    const response = await fetcher(options.endpoint ?? osvEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ queries: batch.map(({ name, version }) => ({ package: { name, ecosystem: 'npm' }, version })) }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`OSV_HTTP_${response.status}`)
    const payload = await response.json() as OsvResponse
    if (!Array.isArray(payload.results) || payload.results.length !== batch.length) throw new Error('OSV_RESPONSE_INVALID')
    payload.results.forEach((result, index) => {
      for (const vulnerability of result.vulns ?? []) findings.push(vulnerabilityFinding(batch[index], vulnerability))
    })
    queriedPackages += batch.length
  }
  return {
    findings,
    summary: {
      scanner: 'osv',
      queriedPackages,
      vulnerabilityFindings: findings.length,
      scannedLockfiles: discoverNpmAuditTargets(options.cwd).length,
      severityAvailable: findings.filter((finding) => finding.severity !== null).length,
      source: 'OSV public batch API',
    },
  }
}