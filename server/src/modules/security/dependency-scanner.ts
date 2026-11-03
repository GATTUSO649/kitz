import { execFile } from 'node:child_process'
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

export function classifySeverity(value: unknown): FindingSeverity {
  if (typeof value !== 'string') return null
  return severityMap[value.toLowerCase()] ?? null
}

export async function runDependencyScanner(options: { cwd: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{ findings: DependencyFinding[]; summary: Record<string, string | number | boolean | null> }> {
  const timeoutMs = options.timeoutMs ?? 120_000
  const npmCli = process.env.npm_execpath?.trim()
  if (!npmCli) throw new Error('NPM_AUDIT_CLI_UNAVAILABLE')
  let stdout: string
  try {
    const result = await execFileAsync(process.execPath, [npmCli, 'audit', '--json', '--omit=optional'], {
      cwd: options.cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NODE_OPTIONS: '', npm_config_update_notifier: 'false' },
      signal: options.signal,
      windowsHide: true,
    })
    stdout = result.stdout
  } catch (error) {
    const executableError = error as { code?: string | number; stdout?: string; stderr?: string }
    if (typeof executableError.code === 'number' || typeof executableError.code === 'string') {
      if (typeof executableError.stdout === 'string' && executableError.stdout.trim()) stdout = executableError.stdout
      else throw new Error(executableError.stderr ? 'NPM_AUDIT_FAILED' : 'NPM_AUDIT_FAILED')
    } else throw error
  }

  const audit = JSON.parse(stdout) as {
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

  const findings = Object.entries(audit.vulnerabilities ?? {}).flatMap(([packageName, vulnerability]) => {
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
        installedNodes: vulnerability.nodes ?? [],
        vulnerableRange: vulnerability.range ?? 'unavailable',
        dependencyPath: vulnerability.effects?.length ? vulnerability.effects.join(' -> ') : packageName,
        advisoryUrl: url || null,
        directDependency: vulnerability.isDirect === true,
        cvssScore: advisory.cvss?.score ?? null,
      }) as Record<string, string | number | boolean | null>
      return {
        id: randomUUID(),
        scanner: dependencyScannerId,
        title,
        description: `${packageName} is affected by a known dependency vulnerability. Review the dependency range and advisory before remediation.`,
        severity: classifySeverity(advisory.severity ?? vulnerability.severity) ?? null,
        cve,
        cwe: advisory.cwe ?? [],
        affectedComponent: packageName,
        affectedFile: 'package-lock.json',
        evidence,
        remediation: fix,
        deduplicationKey: `${packageName}:${title}:${vulnerability.range ?? 'unknown'}`,
        lifecycleStatus: 'OPEN',
        verificationStatus: 'UNVERIFIED',
      }
    })
  })

  const counts = Object.values(audit.metadata?.vulnerabilities ?? {}).reduce((sum, value) => sum + value, 0)
  return {
    findings,
    summary: {
      packageFindings: Object.keys(audit.vulnerabilities ?? {}).length,
      advisoryFindings: findings.length,
      reportedVulnerabilityCount: counts,
      scanner: dependencyScannerId,
      severityAvailable: findings.filter((finding) => finding.severity !== null).length,
    },
  }
}
