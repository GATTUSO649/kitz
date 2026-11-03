import { randomUUID } from 'node:crypto'
import { runDependencyScanner, type DependencyFinding } from './dependency-scanner.js'

export const externalScannerModules = ['dependency', 'secrets', 'source', 'api', 'database', 'configuration', 'infrastructure', 'web'] as const
export type ScannerModule = typeof externalScannerModules[number]
export type ScanStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
export type ModuleStatus = 'queued' | 'running' | 'successful' | 'partial' | 'failed' | 'unsupported' | 'not_configured' | 'cancelled'

export type SecurityScanModule = {
  module: ScannerModule
  status: ModuleStatus
  findingCount: number
  unsupportedReason?: string
  errorCode?: string
  startedAt?: string
  completedAt?: string
}

export type SecurityScan = {
  id: string
  status: ScanStatus
  scope: ScannerModule[]
  modules: SecurityScanModule[]
  findings: DependencyFinding[]
  summary: Record<string, string | number | boolean | null>
  errorCode?: string
  startedAt: string
  completedAt?: string
}

const scans = new Map<string, SecurityScan>()
let activeScan: AbortController | null = null
let activeScanId: string | null = null

const notConfigured = (module: ScannerModule): SecurityScanModule => ({
  module,
  status: module === 'dependency' ? 'queued' : 'not_configured',
  findingCount: 0,
  unsupportedReason: module === 'dependency' ? undefined : 'Scanner integration is not configured in this deployment.',
})

export function getSecurityOverview() {
  const ordered = [...scans.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const findings = ordered.flatMap((scan) => scan.findings)
  const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFORMATIONAL: 0, UNASSESSED: 0 }
  for (const finding of findings) {
    if (!finding.severity) severityCounts.UNASSESSED++
    else severityCounts[finding.severity]++
  }
  const latest = ordered[0]
  return {
    findings: findings.length,
    severityCounts,
    latestScan: latest ? { id: latest.id, status: latest.status, completedAt: latest.completedAt ?? null } : null,
    activeScanId,
    coverage: {
      repository: latest ? latest.modules.some((module) => module.status === 'successful') : false,
      dependency: latest?.modules.some((module) => module.module === 'dependency' && module.status === 'successful') ?? false,
      secrets: false,
      source: false,
      api: false,
      database: false,
      configuration: false,
      infrastructure: false,
      web: false,
    },
    score: null,
    scoreLimitations: ['Security score is not calculated without verified scanner coverage.', 'Unavailable assessments are excluded rather than treated as zero findings.'],
  }
}

export function listSecurityScans() {
  return [...scans.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export function getSecurityScan(id: string) {
  return scans.get(id)
}

export function updateSecurityFinding(id: string, lifecycleStatus: string, verificationStatus: string) {
  for (const finding of listSecurityFindings()) {
    if (finding.id !== id) continue
    finding.lifecycleStatus = lifecycleStatus
    finding.verificationStatus = verificationStatus
    return finding
  }
  return null
}

export function listSecurityFindings() {
  const unique = new Map<string, DependencyFinding>()
  for (const scan of [...scans.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    for (const finding of scan.findings) {
      if (!unique.has(finding.deduplicationKey)) unique.set(finding.deduplicationKey, finding)
    }
  }
  return [...unique.values()]
}

export function cancelSecurityScan(id: string) {
  if (activeScanId !== id || !activeScan) return false
  activeScan.abort()
  const scan = scans.get(id)
  if (scan && scan.status === 'running') {
    scan.status = 'cancelled'
    scan.completedAt = new Date().toISOString()
    scan.modules = scan.modules.map((module) => module.status === 'running' ? { ...module, status: 'cancelled', completedAt: scan.completedAt } : module)
  }
  return true
}

export async function startSecurityScan(scope: ScannerModule[], cwd: string, timeoutMs = 120_000, onUpdate?: (scan: SecurityScan) => Promise<void> | void) {
  if (activeScanId) throw Object.assign(new Error('A security scan is already running.'), { code: 'SECURITY_SCAN_CONFLICT' })
  const normalizedScope: ScannerModule[] = [...new Set(scope.length ? scope : (['dependency'] as ScannerModule[]))]
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  const scan: SecurityScan = {
    id,
    status: 'queued',
    scope: normalizedScope,
    modules: normalizedScope.map(notConfigured),
    findings: [],
    summary: {},
    startedAt,
  }
  scans.set(id, scan)
  const controller = new AbortController()
  activeScan = controller
  activeScanId = id
  scan.status = 'running'

  await Promise.resolve(onUpdate?.(scan)).catch(() => undefined)
  void runScan(scan, controller, cwd, timeoutMs, onUpdate).finally(() => {
    if (activeScanId === id) {
      activeScanId = null
      activeScan = null
    }
  })
  return scan
}

async function runScan(scan: SecurityScan, controller: AbortController, cwd: string, timeoutMs: number, onUpdate?: (scan: SecurityScan) => Promise<void> | void) {
  let successfulModules = 0
  let failedModules = 0
  let unsupportedModules = 0
  try {
    for (const moduleState of scan.modules) {
      if (controller.signal.aborted) break
      if (moduleState.module !== 'dependency') {
        unsupportedModules++
        continue
      }
      moduleState.status = 'running'
      moduleState.startedAt = new Date().toISOString()
      try {
        const result = await runDependencyScanner({ cwd, timeoutMs, signal: controller.signal })
        if (controller.signal.aborted) throw new Error('SCAN_CANCELLED')
        moduleState.status = 'successful'
        moduleState.findingCount = result.findings.length
        moduleState.completedAt = new Date().toISOString()
        scan.findings.push(...result.findings)
        await Promise.resolve(onUpdate?.(scan)).catch(() => undefined)
        scan.summary = { ...scan.summary, ...result.summary }
        successfulModules++
      } catch (error) {
        failedModules++
        moduleState.status = 'failed'
        moduleState.errorCode = error instanceof Error && error.message === 'SCAN_CANCELLED' ? 'SCAN_CANCELLED' : 'NPM_AUDIT_FAILED'
        moduleState.completedAt = new Date().toISOString()
        await Promise.resolve(onUpdate?.(scan)).catch(() => undefined)
      }
    }
    if (controller.signal.aborted) {
      scan.status = 'cancelled'
      scan.errorCode = 'SCAN_CANCELLED'
    } else if (failedModules > 0 && successfulModules > 0) {
      scan.status = 'partial'
      scan.errorCode = 'PARTIAL_SCAN'
    } else if (failedModules > 0) {
      scan.status = 'failed'
      scan.errorCode = 'NPM_AUDIT_FAILED'
    } else {
      scan.status = successfulModules > 0 ? 'completed' : unsupportedModules === scan.modules.length ? 'partial' : 'failed'
    }
  } finally {
    scan.completedAt = new Date().toISOString()
    scan.summary = {
      ...scan.summary,
      findings: scan.findings.length,
      successfulModules,
      failedModules,
      unsupportedModules,
    }
    await Promise.resolve(onUpdate?.(scan)).catch(() => undefined)
  }
}
