import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

export const dependencyScannerId = 'npm-audit'
export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFORMATIONAL' | null

export type DependencyFinding = {
  id: string
  scanner: string
  title: string
  description: string
  severity: FindingSeverity
  cve: string[]
  cwe: string[]
  affectedComponent: string
  affectedFile: string
  evidence: Record<string, string | number | boolean | null>
  remediation: string
  deduplicationKey: string
  lifecycleStatus?: string
  verificationStatus?: string
}

const secretPatterns = [/\b(?:password|passwd|pwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*["']?[^\s,}"']+/gi]

export function redactSensitiveEvidence(value: unknown): unknown {
  if (typeof value === 'string') {
    let redacted = value
    for (const pattern of secretPatterns) redacted = redacted.replace(pattern, (match) => `${match.slice(0, Math.max(1, match.indexOf(match.match(/[:=]/)?.[0] ?? '') + 1))}[REDACTED]`)
    return redacted
  }
  if (Array.isArray(value)) return value.map(redactSensitiveEvidence)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      /(?:password|passwd|pwd|secret|token|api[_-]?key|authorization)/i.test(key) ? '[REDACTED]' : redactSensitiveEvidence(child),
    ]))
  }
  return value
}

const severityMap: Record<string, FindingSeverity> = {
  critical: 'CRITICAL', high: 'HIGH', moderate: 'MEDIUM', medium: 'MEDIUM', low: 'LOW', info: 'INFORMATIONAL', informational: 'INFORMATIONAL',
}

const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage'])

export function discoverNpmAuditTargets(cwd: string) {
  const ancestors: string[] = []
  let directory = resolve(cwd)
  for (let depth = 0; depth < 8; depth++) {
    ancestors.push(directory)
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  const isNpmProject = (candidate: string) =>
    existsSync(join(candidate, 'package.json')) && existsSync(join(candidate, 'package-lock.json'))
  const repositoryRoot = ancestors.find((candidate) => isNpmProject(candidate) && existsSync(join(candidate, 'platform', 'package-lock.json')))
    ?? ancestors.find(isNpmProject)
    ?? resolve(cwd)
  const targets: { root: string; lockfile: string }[] = []
  const pending = [repositoryRoot]

  while (pending.length) {
    const current = pending.pop()!
    const packageFile = join(current, 'package.json')
    const lockfile = join(current, 'package-lock.json')
    if (existsSync(packageFile) && existsSync(lockfile)) targets.push({ root: current, lockfile })
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) pending.push(join(current, entry.name))
    }
  }

  return targets.sort((left, right) => left.root.localeCompare(right.root))
}

export function classifySeverity(value: unknown): FindingSeverity {
  if (typeof value !== 'string') return null
  return severityMap[value.toLowerCase()] ?? null
}

export async function runDependencyScanner(options: { cwd: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{ findings: DependencyFinding[]; summary: Record<string, string | number | boolean | null> }> {
  const timeoutMs = options.timeoutMs ?? 120_000
  const npmCli = process.env.npm_execpath?.trim()
  if (!npmCli) throw new Error('NPM_AUDIT_CLI_UNAVAILABLE')
  const targets = discoverNpmAuditTargets(options.cwd)
  if (!targets.length) throw new Error('NPM_AUDIT_LOCKFILE_NOT_FOUND')
  const auditResults: { root: string; audit: NpmAuditResult }[] = []

  for (const target of targets) {
    let stdout: string
    try {
      const result = await execFileAsync(process.execPath, [npmCli, 'audit', '--json', '--omit=optional'], {
        cwd: target.root,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, NODE_OPTIONS: '', npm_config_update_notifier: 'false' },
        signal: options.signal,
        windowsHide: true,
      })
      stdout = result.stdout
    } catch (error) {
      const executableError = error as { code?: string | number; stdout?: string; stderr?: string }
      if ((typeof executableError.code === 'number' || typeof executableError.code === 'string') && typeof executableError.stdout === 'string' && executableError.stdout.trim()) {
        stdout = executableError.stdout
      } else {
        throw new Error('NPM_AUDIT_FAILED')
      }
    }
    auditResults.push({ root: target.root, audit: JSON.parse(stdout) as NpmAuditResult })
  }

  const findings = auditResults.flatMap(({ root, audit }) => Object.entries(audit.vulnerabilities ?? {}).flatMap(([packageName, vulnerability]) => {
    const advisoryVia = vulnerability.via?.filter((entry): entry is { title?: string; url?: string; severity?: string; cwe?: string[]; cvss?: { score?: number } } => typeof entry === 'object') ?? []
    const advisories = advisoryVia.length ? advisoryVia : [{ title: `${packageName} contains a vulnerable dependency`, severity: vulnerability.severity }]
    return advisories.map((advisory) => {
      const title = advisory.title ?? `${packageName} dependency vulnerability`
      const url = advisory.url ?? ''
      const cve = url.match(/CVE-\d{4}-\d+/i)?.[0]?.toUpperCase() ? [url.match(/CVE-\d{4}-\d+/i)![0].toUpperCase()] : []
      const fix = vulnerability.fixAvailable && typeof vulnerability.fixAvailable === 'object'
        ? `Update ${vulnerability.fixAvailable.name ?? packageName} to ${vulnerability.fixAvailable.version ?? 'the available patched version'}${vulnerability.fixAvailable.isSemVerMajor ? ' (major upgrade)' : ''}.`
        : 'No automatic fix is currently reported by npm audit. Review the advisory and apply an approved remediation.'
      const evidence = redactSensitiveEvidence({
        package: packageName,
        project: relative(options.cwd, root) || '.',
        installedNodes: vulnerability.nodes ?? [],
        vulnerableRange: vulnerability.range ?? 'unavailable',
        dependencyPath: vulnerability.effects?.length ? vulnerability.effects.join(' -> ') : packageName,
        advisoryUrl: url || null,
        directDependency: vulnerability.isDirect === true,
        cvssScore: advisory.cvss?.score ?? null,
      }) as Record<string, string | number | boolean | null>
      const projectPath = relative(options.cwd, root).replaceAll('\\', '/')
      return {
        id: randomUUID(),
        scanner: dependencyScannerId,
        title,
        description: `${packageName} is affected by a known dependency vulnerability. Review the dependency range and advisory before remediation.`,
        severity: classifySeverity(advisory.severity ?? vulnerability.severity) ?? null,
        cve,
        cwe: advisory.cwe ?? [],
        affectedComponent: packageName,
        affectedFile: projectPath ? `${projectPath}/package-lock.json` : 'package-lock.json',
        evidence,
        remediation: fix,
        deduplicationKey: `${projectPath}:${packageName}:${title}:${vulnerability.range ?? 'unknown'}`,
        lifecycleStatus: 'OPEN',
        verificationStatus: 'UNVERIFIED',
      }
    })
  }))

  const vulnerabilities = auditResults.flatMap(({ audit }) => Object.values(audit.metadata?.vulnerabilities ?? {}))
  const reportedVulnerabilityCount = vulnerabilities.reduce((sum, value) => sum + value, 0)
  return {
    findings,
    summary: {
      packageFindings: auditResults.reduce((sum, { audit }) => sum + Object.keys(audit.vulnerabilities ?? {}).length, 0),
      advisoryFindings: findings.length,
      reportedVulnerabilityCount,
      scanner: dependencyScannerId,
      scannedProjects: auditResults.length,
      scannedLockfiles: targets.length,
      severityAvailable: findings.filter((finding) => finding.severity !== null).length,
    },
  }
}

type NpmAuditResult = {
    metadata?: { vulnerabilities?: Record<string, number> }
    vulnerabilities?: Record<string, {
      name?: string
      severity?: string
      isDirect?: boolean
      nodes?: string[]
      range?: string
      fixAvailable?: false | { name?: string; version?: string; isSemVerMajor?: boolean }
      via?: Array<string | { title?: string; url?: string; severity?: string; cwe?: string[]; cvss?: { score?: number } }>
      effects?: string[]
    }>
}
