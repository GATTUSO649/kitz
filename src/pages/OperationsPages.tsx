import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BellRing,
  BriefcaseBusiness,
  CloudCog,
  Database,
  Download,
  FileWarning,
  HardDrive,
  LayoutDashboard,
  Lock,
  LogOut,
  Printer,
  Radar,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  Siren,
  TrendingUp,
  Wallet,
  Workflow,
} from 'lucide-react'
import '../operations-theme.css'

type OperationsPayload<T> = {
  data?: T
  error?: { code?: string; message?: string; requestId?: string }
  pagination?: { nextCursor: number | null; hasMore: boolean }
}

type EndpointMetric = { endpoint: string; requests: number; errors: number; averageResponseMs: number }
type RequestBucket = { bucketStartedAt: string; requestCount: number; errorCount: number; serverErrorCount: number }
type RequestSeriesBucket = RequestBucket & { securitySignalCount: number; averageResponseMs: number | null; p95ResponseMs: number | null }

type OperationsOverview = {
  application: { status: string; uptimeSeconds: number; nodeVersion: string; memoryRssBytes: number; heapUsedBytes: number }
  databases: { name: string; status: string; latencyMs: number | null }[]
  requests: {
    requestCount: number
    requestsLastMinute: number
    errorCount: number
    clientErrorCount: number
    serverErrorCount: number
    successfulRequestCount: number
    securitySignalCount: number
    securitySignalsLastMinute: number
    averageResponseMs: number | null
    minResponseMs?: number | null
    maxResponseMs?: number | null
    p50ResponseMs?: number | null
    p95ResponseMs: number | null
    p99ResponseMs?: number | null
    requestRatePerSecond?: number
    telemetryFreshness?: string
    endpoints: EndpointMetric[]
    collectedAt: string
    timeline: RequestSeriesBucket[]
    methods: { method: string; requests: number }[]
    responseDistribution: { success: number; redirect: number; clientError: number; serverError: number }
  }
  databasePool?: { totalConnections: number; idleConnections: number; waitingRequests: number; maxConnections: number | null } | null
  incidents: { open: number; investigating: number }
  externalServices: Record<string, { status: string; reason?: string }>
}

type Incident = {
  id: number
  incidentNumber: string
  severity: 'P1' | 'P2' | 'P3' | 'P4'
  status: 'open' | 'investigating' | 'resolved' | 'closed'
  title: string
  description: string
  affectedComponent: string
  assignedOperationsUserId: number | null
  assigneeName: string | null
  rootCause: string | null
  resolutionNotes: string | null
  detectedAt: string
  updatedAt: string
}

type IncidentEvent = { id: number; eventType: string; message: string; createdAt: string; actorName: string }
type OperationsAudit = { id: number; actorType: string; actorName: string | null; action: string; targetType: string; targetId: string; details: string | null; createdAt: string }
type OperationsUser = { id: number; email?: string; fullName: string; role?: ItAccessRole; disabledAt?: string | null; lastLoginAt?: string | null }
type ItAccessRole = 'super_admin' | 'security_analyst' | 'it_support' | 'database_admin' | 'infrastructure_admin' | 'viewer'
type RolePermissionDefinition = { role: ItAccessRole; description: string; permissions: string[] }
type OperationsPermissions = { roles: RolePermissionDefinition[]; permissions: string[]; users: OperationsUser[] }
type MonitoringRule = { ruleId: string; name: string; description: string; condition: string; threshold: number; windowSeconds: number; severity: string; cooldownSeconds: number; enabled: boolean; recommendedResponse: string }
type MonitoringAlert = { id: number; severity: string; description: string; affectedService: string; status: string; firstOccurrence: string; lastOccurrence: string; occurrenceCount: number; assignedOperationsUserId: number | null; resolutionInformation: string | null; ruleId: string; ruleName: string }
type MonitoringWorker = { workerName: string; lastHeartbeatAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; failureCount: number; lastErrorCode: string | null; status: string }
type MonitoringHealth = { checkedAt: string; telemetryFreshness: string; services: { name: string; state: string; latencyMs?: number | null; source: string }[]; queue: { queueDepth: number; droppedEvents: number; storageFailures: number; persistedEvents: number; lastPersistedAt: string | null; lastFailureAt: string | null; storageConfigured: boolean } }
type DatabasePerformance = { telemetryAvailable: boolean; metrics: { metricType: string; operation: string; sampleCount: number; successCount: number; failureCount: number; slowCount: number; averageDurationMs: number; minDurationMs: number; maxDurationMs: number; p50DurationMs: number | null; p95DurationMs: number | null; p99DurationMs: number | null; histogramEstimate: boolean; instanceCount: number }[] }
type RuntimePerformance = { telemetryAvailable: boolean; sampleCount: number; instanceCount: number; processCpuAveragePercent: number | null; processCpuP95Percent: number | null; processRssAverageBytes: number | null; processRssMaxBytes: number | null; processHeapAverageBytes: number | null; processHeapMaxBytes: number | null; processExternalAverageBytes: number | null; runtimeAvailableMemoryBytes: number | null; runtimeConstrainedMemoryBytes: number | null; eventLoopUtilizationAveragePercent: number | null; eventLoopP95DelaySampleMaxMs: number | null; hostCpuUtilizationPercent: number | null; hostMemoryBytes: number | null; hostMetricsStatus: string }
type ProviderPerformance = { metrics: { provider: string; operation: string; requestCount: number; rejectedCount: number; acceptedByProviderCount: number; averageDurationMs: number; p95DurationMs: number | null; p99DurationMs: number | null; lastAttemptAt: string }[]; integrations: { provider: string; state: string; health: string; reason: string }[] }
type SecurityOverview = { findings: number; severityCounts: Record<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFORMATIONAL' | 'UNASSESSED', number>; latestScan: { id: string; status: string; completedAt: string | null } | null; activeScanId: string | null; coverage: Record<string, boolean>; score: number | null }
type SecurityFinding = { id: string; scanner: string; title: string; description: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFORMATIONAL' | null; affectedComponent: string; affectedFile: string; evidence: Record<string, unknown>; remediation: string; lifecycleStatus?: string }
type SecurityScanner = { scanner: string; status: string; coverage: string; source: string }
type SecurityScan = { id: string; status: string; scope: string[]; modules: { module: string; status: string; findingCount: number; unsupportedReason?: string }[]; findings: SecurityFinding[]; summary: Record<string, string | number | boolean | null>; startedAt: string; completedAt?: string }
type ModuleKey =
  | 'overview'
  | 'traffic'
  | 'observability'
  | 'security'
  | 'threat-detection'
  | 'vulnerabilities'
  | 'identity-access'
  | 'database'
  | 'payments'
  | 'integrations'
  | 'incidents'
  | 'support'
  | 'backups'
  | 'deployments'
  | 'reports'
  | 'audit'
  | 'settings'
  | 'security-config'

type ModuleGroup = { label: string; items: { key: ModuleKey; label: string; icon: typeof LayoutDashboard; status: 'live' | 'watch' | 'guarded' }[] }

class OperationsApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly requestId?: string

  constructor(message: string, status: number, code?: string, requestId?: string) {
    super(requestId ? `${message} (Reference: ${requestId})` : message)
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

async function operationsApi<T>(url: string, init?: RequestInit): Promise<OperationsPayload<T>> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  const payload = (await response.json().catch(() => ({}))) as OperationsPayload<T>
  if (!response.ok) {
    throw new OperationsApiError(
      payload.error?.message ?? 'Operations request failed.',
      response.status,
      payload.error?.code,
      payload.error?.requestId,
    )
  }

  return payload
}

const moduleGroups: ModuleGroup[] = [
  {
    label: 'Overview',
    items: [
      { key: 'overview', label: 'Operations Dashboard', icon: LayoutDashboard, status: 'live' },
      { key: 'traffic', label: 'Traffic Analytics', icon: TrendingUp, status: 'live' },
      { key: 'observability', label: 'Observability', icon: Radar, status: 'live' },
    ],
  },
  {
    label: 'Security',
    items: [
      { key: 'security', label: 'Security Centre', icon: Shield, status: 'guarded' },
      { key: 'threat-detection', label: 'Threat Detection', icon: ShieldAlert, status: 'guarded' },
      { key: 'vulnerabilities', label: 'Vulnerabilities', icon: FileWarning, status: 'guarded' },
      { key: 'identity-access', label: 'Identity and Access', icon: Lock, status: 'guarded' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { key: 'database', label: 'Database', icon: Database, status: 'watch' },
      { key: 'payments', label: 'Payments', icon: Wallet, status: 'watch' },
      { key: 'integrations', label: 'Integrations', icon: CloudCog, status: 'watch' },
      { key: 'incidents', label: 'Incidents', icon: Siren, status: 'live' },
      { key: 'support', label: 'IT Support', icon: BriefcaseBusiness, status: 'watch' },
      { key: 'backups', label: 'Backups', icon: HardDrive, status: 'guarded' },
      { key: 'deployments', label: 'Deployments', icon: Workflow, status: 'guarded' },
      { key: 'reports', label: 'Reports', icon: BellRing, status: 'watch' },
      { key: 'audit', label: 'Audit Logs', icon: Search, status: 'live' },
      { key: 'settings', label: 'Settings', icon: Server, status: 'guarded' },
    ],
  },
  {
    label: 'Security setup',
    items: [{ key: 'security-config', label: 'Security Configuration', icon: Shield, status: 'guarded' }],
  },
]

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function clampPercent(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

const securityAssessmentFindings = [
  { severity: 'MEDIUM', title: 'Runtime PostgreSQL role bypasses RLS', status: 'Open - owner decision required', recommendation: 'Review a dedicated least-privilege runtime role and RLS strategy in staging before changing grants.' },
  { severity: 'MEDIUM', title: 'Administrator accounts have broad shared access', status: 'Open - permission matrix required', recommendation: 'Approve least-privilege business roles and test route authorization before rollout.' },
  { severity: 'LOW', title: 'Public quick ratings accept client-selected visitor IDs', status: 'Open - abuse controls limited', recommendation: 'Treat ratings as non-authoritative until stronger identity or abuse controls are approved.' },
  { severity: 'LOW', title: 'Uploaded images are signature-checked but not decoded and re-encoded', status: 'Open - bounded upload validation', recommendation: 'Evaluate bounded decoding and dimension limits with compatibility tests.' },
  { severity: 'LOW', title: 'Registration can reveal whether an email is already registered', status: 'Open - response contract decision required', recommendation: 'Consider uniform registration acknowledgements without changing the existing contract before approval.' },
  { severity: 'UNVERIFIED', title: 'Live M-Pesa service behavior', status: 'Unverified - STK unavailable in assessment', recommendation: 'Perform an approved low-value transaction and verify callback reconciliation before live-commerce assurance.' },
  { severity: 'UNVERIFIED', title: 'Backup and restore readiness', status: 'Unverified - restore test not evidenced', recommendation: 'Complete and record a restore test in an isolated staging environment.' },
  { severity: 'UNVERIFIED', title: 'Render and Cloudflare security configuration', status: 'Unverified - provider settings not inspected', recommendation: 'Verify DNS proxy coverage, WAF, TLS, and origin reachability in authorized provider dashboards.' },
]

function escapeReportHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

function reportLineChart(title: string, labels: string[], series: { label: string; color: string; values: (number | null)[] }[]) {
  const numericValues = series.flatMap((item) => item.values.filter((value): value is number => value !== null && Number.isFinite(value)))
  if (!numericValues.length || !labels.length) return `<section class="chart" style="break-inside:avoid;border:1px solid #d5e0e9;border-radius:6px;padding:16px;margin:0 0 14px"><h3>${escapeReportHtml(title)}</h3><p class="muted">No samples available for this chart.</p></section>`

  const maximum = Math.max(1, ...numericValues)
  const chartWidth = 680
  const chartHeight = 210
  const xFor = (index: number) => labels.length < 2 ? 340 : 34 + (index * 612) / (labels.length - 1)
  const yFor = (value: number) => 166 - (value / maximum) * 132
  const grid = [34, 78, 122, 166].map((y) => `<line x1="34" x2="646" y1="${y}" y2="${y}" stroke="#d8e2eb" stroke-width="1" stroke-dasharray="3 5"/>`).join('')
  const plottedSeries = series.map((item) => {
    let segments: string[][] = []
    let currentSegment: string[] = []
    const points = item.values.map((value, index) => {
      if (value === null || !Number.isFinite(value)) {
        if (currentSegment.length) segments.push(currentSegment)
        currentSegment = []
        return ''
      }
      const x = xFor(index)
      const y = yFor(value)
      currentSegment.push(`${x},${y}`)
      return `<circle cx="${x}" cy="${y}" r="3" fill="${item.color}"><title>${escapeReportHtml(labels[index])} · ${escapeReportHtml(item.label)}: ${value}</title></circle>`
    }).join('')
    if (currentSegment.length) segments.push(currentSegment)
    const lines = segments.filter((segment) => segment.length > 1).map((segment) => `<polyline points="${segment.join(' ')}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('')
    return `<g>${lines}${points}</g>`
  }).join('')
  const axisLabels = [labels[0], labels[Math.floor((labels.length - 1) / 2)], labels.at(-1) ?? ''].map(escapeReportHtml)

  return `<section class="chart" style="break-inside:avoid;border:1px solid #d5e0e9;border-radius:6px;padding:16px;margin:0 0 14px;background:#fbfdff"><header style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><h3 style="margin:0 0 8px;font-size:15px">${escapeReportHtml(title)}</h3><div style="display:flex;flex-wrap:wrap;gap:10px;font-size:10px">${series.map((item) => `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:${item.color}"></i>${escapeReportHtml(item.label)}</span>`).join('')}</div></header><svg style="display:block;width:100%;height:auto;max-height:240px" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="${escapeReportHtml(title)}"><g>${grid}</g>${plottedSeries}</svg><div style="display:flex;justify-content:space-between;color:#5d6c7d;font-size:10px"><span>${axisLabels[0]}</span><span>${axisLabels[1]}</span><span>${axisLabels[2]}</span></div></section>`
}

function reportDonutChart(title: string, entries: { label: string; value: number; color: string }[]) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.value), 0)
  if (!total) return `<section class="chart" style="break-inside:avoid;border:1px solid #d5e0e9;border-radius:6px;padding:16px;margin:0 0 14px"><h3>${escapeReportHtml(title)}</h3><p class="muted">No samples available for this chart.</p></section>`

  const radius = 52
  const circumference = 2 * Math.PI * radius
  let offset = 0
  const arcs = entries.filter((entry) => entry.value > 0).map((entry) => {
    const length = (entry.value / total) * circumference
    const arc = `<circle cx="70" cy="70" r="${radius}" fill="none" stroke="${entry.color}" stroke-width="22" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"/>`
    offset += length
    return arc
  }).join('')
  const legend = entries.map((entry) => `<li style="display:grid;grid-template-columns:10px minmax(70px,1fr) auto;align-items:center;gap:7px;margin:0 0 7px"><i style="width:8px;height:8px;border-radius:50%;background:${entry.color}"></i><span>${escapeReportHtml(entry.label)}</span><strong>${entry.value}</strong></li>`).join('')
  return `<section class="chart" style="break-inside:avoid;border:1px solid #d5e0e9;border-radius:6px;padding:16px;margin:0 0 14px;background:#fbfdff"><header style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><h3 style="margin:0 0 8px;font-size:15px">${escapeReportHtml(title)}</h3><strong>${total} responses</strong></header><div style="display:flex;align-items:center;justify-content:center;gap:28px;min-height:180px"><svg style="width:152px;height:152px;flex:none" viewBox="0 0 140 140" role="img" aria-label="${escapeReportHtml(title)} across ${total} responses"><g transform="rotate(-90 70 70)">${arcs}</g><circle cx="70" cy="70" r="39" fill="#fff"/><text x="70" y="76" text-anchor="middle" style="font-size:16px;font-weight:bold;fill:#182538">${total}</text></svg><ul style="list-style:none;padding:0;margin:0;font-size:11px">${legend}</ul></div></section>`
}

function reportBarChart(title: string, items: { label: string; value: number }[]) {
  const validItems = items.filter((item) => Number.isFinite(item.value) && item.value >= 0)
  if (!validItems.length) return `<section class="chart" style="break-inside:avoid;border:1px solid #d5e0e9;border-radius:6px;padding:16px;margin:0 0 14px"><h3>${escapeReportHtml(title)}</h3><p class="muted">No samples available for this chart.</p></section>`
  const maximum = Math.max(1, ...validItems.map((item) => item.value))
  const bars = validItems.map((item) => {
    const width = Math.max(item.value > 0 ? 2 : 0, (item.value / maximum) * 100)
    return `<div style="display:grid;grid-template-columns:minmax(90px,1.3fr) minmax(45px,3fr) 40px;align-items:center;gap:10px;margin:0 0 11px;font-size:11px"><span title="${escapeReportHtml(item.label)}" style="overflow:hidden;text-overflow:ellipsis">${escapeReportHtml(item.label)}</span><div style="height:9px;overflow:hidden;border-radius:99px;background:#e6edf2"><i style="display:block;height:100%;border-radius:99px;background:#287ca8;width:${width.toFixed(2)}%"></i></div><strong style="text-align:right">${escapeReportHtml(item.value)}</strong></div>`
  }).join('')
  return `<section class="chart" style="break-inside:avoid;border:1px solid #d5e0e9;border-radius:6px;padding:16px;margin:0 0 14px;background:#fbfdff"><header style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><h3 style="margin:0 0 12px;font-size:15px">${escapeReportHtml(title)}</h3><span class="muted">${validItems.length} items</span></header><div>${bars}</div></section>`
}

function buildSecurityReportHtml(overview: OperationsOverview | undefined, generatedAt: Date) {
  const requests = overview?.requests
  const databaseRows = (overview?.databases ?? []).map((database) => `<tr><td>${escapeReportHtml(database.name)}</td><td>${escapeReportHtml(database.status)}</td><td>${database.latencyMs === null ? 'Unavailable' : `${escapeReportHtml(database.latencyMs)} ms`}</td></tr>`).join('')
  const providerRows = Object.entries(overview?.externalServices ?? {}).map(([name, service]) => `<tr><td>${escapeReportHtml(name)}</td><td>${escapeReportHtml(service.status)}</td><td>${escapeReportHtml(service.reason ?? 'No reason reported')}</td></tr>`).join('')
  const findingRows = securityAssessmentFindings.map((finding) => `<tr><td><span class="severity">${escapeReportHtml(finding.severity)}</span></td><td><strong>${escapeReportHtml(finding.title)}</strong><br><span class="muted">${escapeReportHtml(finding.status)}</span></td><td>${escapeReportHtml(finding.recommendation)}</td></tr>`).join('')
  const endpointRows = (requests?.endpoints ?? []).slice(0, 20).map((endpoint) => `<tr><td>${escapeReportHtml(endpoint.endpoint)}</td><td>${endpoint.requests}</td><td>${endpoint.errors}</td><td>${escapeReportHtml(endpoint.averageResponseMs)} ms</td></tr>`).join('')
  const generatedLabel = generatedAt.toISOString()
  const trafficCollected = requests?.collectedAt ? new Date(requests.collectedAt).toISOString() : 'Unavailable'
  const requestSignalScore = requests?.requestCount
    ? `${(10 * requests.securitySignalCount / requests.requestCount).toFixed(1)} / 10`
    : 'Unavailable - no request samples'
  const timeline = requests?.timeline ?? []
  const timelineLabels = timeline.map((bucket) => new Date(bucket.bucketStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
  const reportCharts = [
    reportLineChart('Application requests and errors', timelineLabels, [
      { label: 'Requests', color: '#287ca8', values: timeline.map((bucket) => bucket.requestCount) },
      { label: 'Errors', color: '#c94949', values: timeline.map((bucket) => bucket.errorCount) },
    ]),
    reportLineChart('Response-time trend', timelineLabels, [
      { label: 'Average ms', color: '#c18a21', values: timeline.map((bucket) => bucket.averageResponseMs) },
      { label: 'P95 ms', color: '#287ca8', values: timeline.map((bucket) => bucket.p95ResponseMs) },
    ]),
    reportLineChart('Authentication and rate-limit status signals', timelineLabels, [
      { label: '401 · 403 · 429', color: '#c94949', values: timeline.map((bucket) => bucket.securitySignalCount) },
    ]),
    reportDonutChart('HTTP response distribution', [
      { label: '2xx', value: requests?.responseDistribution.success ?? 0, color: '#27805b' },
      { label: '3xx', value: requests?.responseDistribution.redirect ?? 0, color: '#287ca8' },
      { label: '4xx', value: requests?.responseDistribution.clientError ?? 0, color: '#c18a21' },
      { label: '5xx', value: requests?.responseDistribution.serverError ?? 0, color: '#c94949' },
    ]),
    reportBarChart('Requests by endpoint', (requests?.endpoints ?? []).slice(0, 10).map((endpoint) => ({ label: endpoint.endpoint, value: endpoint.requests }))),
    reportBarChart('Traffic by HTTP method', (requests?.methods ?? []).map((method) => ({ label: method.method, value: method.requests }))),
    reportBarChart('Current database probe latency · ms', (overview?.databases ?? []).flatMap((database) => database.latencyMs === null ? [] : [{ label: database.name, value: database.latencyMs }]))
  ].join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KitCulture Website Security Report</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef3f8;color:#182538;font:14px/1.55 Arial,sans-serif}.report{width:min(100%,1000px);margin:28px auto;background:#fff;padding:44px 52px;box-shadow:0 12px 38px #18304a1c}.eyebrow{color:#2676a9;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:3px solid #176a75;padding-bottom:24px}.top h1{margin:7px 0 8px;font-size:30px;line-height:1.15}.top p,.muted{color:#5d6c7d}.meta{text-align:right;font-size:12px;color:#536579}.actions{display:flex;gap:8px;margin:18px 0 26px}.actions button{border:0;border-radius:4px;padding:10px 14px;background:#176a75;color:#fff;font-weight:700;cursor:pointer}.actions button.secondary{background:#e8eff4;color:#203b52}h2{margin:28px 0 10px;padding-bottom:7px;border-bottom:1px solid #d5e0e9;font-size:18px}h3{margin:0 0 6px;font-size:15px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.metric{border:1px solid #d5e0e9;border-radius:5px;padding:12px;background:#f8fafc}.metric span{display:block;color:#607185;font-size:10px;text-transform:uppercase}.metric strong{display:block;margin-top:5px;font-size:20px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px 8px;border-bottom:1px solid #e1e8ee;text-align:left;vertical-align:top}th{background:#f3f7fa;color:#506376;font-size:10px;text-transform:uppercase}.severity{display:inline-block;min-width:60px;color:#8a4c18;font-weight:700}.notice{border-left:4px solid #d49a3b;background:#fff8e9;padding:12px 14px;color:#513c1a}.foot{margin-top:30px;border-top:1px solid #d5e0e9;padding-top:12px;color:#617286;font-size:11px}.nowrap{white-space:nowrap}@media(max-width:700px){.report{margin:0;padding:24px 18px}.top{display:block}.meta{text-align:left;margin-top:12px}.summary{grid-template-columns:repeat(2,1fr)}table{font-size:11px}}@media print{body{background:#fff}.report{width:100%;margin:0;padding:14mm;box-shadow:none}.actions{display:none}h2,h3{break-after:avoid}tr{break-inside:avoid}thead{display:table-header-group}}
</style></head><body><main class="report"><header class="top"><div><span class="eyebrow">KitCulture · Security Operations</span><h1>Website Security Report</h1><p>Current application telemetry and the latest documented security assessment findings.</p></div><div class="meta"><strong>Generated</strong><br>${escapeReportHtml(generatedLabel)}<br><br><strong>Assessment snapshot</strong><br>2026-11-02</div></header>
<div class="actions"><button onclick="window.print()" type="button">Print / Save as PDF</button></div>
<div class="notice"><strong>Scope and limitations.</strong> This is an operational summary, not a penetration test or security certification. Application traffic uses persistent request events when available and is explicitly labeled process-local when falling back. Infrastructure, CDN, production payment behavior, and backup recoverability are not inferred where provider verification is unavailable.</div>
<h2>Executive summary</h2><p>The security assessment is <strong>NOT READY for an unconditional production-security claim</strong>. Application-layer controls were observed, but material database, privilege, and external verification risks remain open. No finding below is marked resolved by this report.</p>
<div class="summary"><div class="metric"><span>Requests sampled</span><strong>${requests ? requests.requestCount : 'Unavailable'}</strong></div><div class="metric"><span>HTTP errors</span><strong>${requests ? requests.errorCount : 'Unavailable'}</strong></div><div class="metric"><span>Server errors</span><strong>${requests ? requests.serverErrorCount : 'Unavailable'}</strong></div><div class="metric"><span>Request signal index</span><strong>${escapeReportHtml(requestSignalScore)}</strong></div></div>
<h2>Application telemetry</h2><p>Collected at ${escapeReportHtml(trafficCollected)}. The 0–10 request signal index is a heuristic based on the proportion of 401, 403, and 429 responses; it is not a confirmed threat level or alert.</p><table><thead><tr><th>Metric</th><th>Current value</th></tr></thead><tbody><tr><td>Requests in telemetry window</td><td>${requests ? requests.requestCount : 'Unavailable'}</td></tr><tr><td>Requests in last minute</td><td>${requests ? requests.requestsLastMinute : 'Unavailable'}</td></tr><tr><td>Successful responses (below 400)</td><td>${requests ? requests.successfulRequestCount : 'Unavailable'}</td></tr><tr><td>Client errors (4xx)</td><td>${requests ? requests.clientErrorCount : 'Unavailable'}</td></tr><tr><td>Server errors (5xx)</td><td>${requests ? requests.serverErrorCount : 'Unavailable'}</td></tr><tr><td>Average response time</td><td>${requests?.averageResponseMs === null || !requests ? 'Unavailable' : `${escapeReportHtml(requests.averageResponseMs)} ms`}</td></tr><tr><td>P95 response time</td><td>${requests?.p95ResponseMs === null || !requests ? 'Unavailable' : `${escapeReportHtml(requests.p95ResponseMs)} ms`}</td></tr><tr><td>Security-related HTTP status signals (401/403/429)</td><td>${requests ? requests.securitySignalCount : 'Unavailable'}</td></tr><tr><td>Telemetry source</td><td>${escapeReportHtml(requests?.telemetryFreshness ?? 'unavailable')}</td></tr></tbody></table>
<h2>Telemetry graphs</h2><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">${reportCharts}</div>
<h2>Database health probes</h2><table><thead><tr><th>Database</th><th>Status</th><th>Current latency</th></tr></thead><tbody>${databaseRows || '<tr><td colspan="3">Unavailable</td></tr>'}</tbody></table>
<h2>External service verification</h2><table><thead><tr><th>Service</th><th>Status</th><th>Evidence / limitation</th></tr></thead><tbody>${providerRows || '<tr><td colspan="3">Unavailable</td></tr>'}</tbody></table>
<h2>Highest-volume route templates</h2><table><thead><tr><th>Endpoint template</th><th>Requests</th><th>Errors</th><th>Average</th></tr></thead><tbody>${endpointRows || '<tr><td colspan="4">No route samples available</td></tr>'}</tbody></table>
<h2>Tracked security findings</h2><table><thead><tr><th>Severity</th><th>Finding / status</th><th>Recommended next step</th></tr></thead><tbody>${findingRows}</tbody></table>
<h2>Observed controls</h2><p>Bcrypt password hashing; opaque database-backed sessions; HttpOnly/SameSite cookies; origin validation; bounded JSON payloads; rate limits; schema validation; parameterized Drizzle queries; generic production errors; sensitive log redaction; and server-side payment callback reconciliation were observed in the source review. These controls do not resolve the open findings above.</p>
<h2>Production verification required</h2><ul><li>Obtain a database-owner decision and staged verification for runtime RLS bypass.</li><li>Approve least-privilege administrator roles and test sensitive route authorization.</li><li>Verify Render/Cloudflare edge and origin configuration in authorized dashboards.</li><li>Perform an isolated backup restore test and an approved live payment callback verification.</li><li>Review all open findings with the accountable owners before making a readiness claim.</li></ul>
<footer class="foot">Source: docs/security-assessment-2026-11-02.md and current protected operations overview. Historical findings are reproduced as assessed and are not automatically updated or closed by current telemetry.</footer></main></body></html>`
}

type ChartSeries = { label: string; color: string; values: number[] }

function OperationsLineChart({ title, labels, series }: { title: string; labels: string[]; series: ChartSeries[] }) {
  const maximum = Math.max(1, ...series.flatMap((item) => item.values))
  const coordinates = series.map((item) => item.values.map((value, index) => ({
    x: labels.length < 2 ? 300 : 34 + (index * 532) / (labels.length - 1),
    y: 170 - (value / maximum) * 132,
  })))

  return (
    <article className="operations-chart-panel">
      <header><div><span className="operations-eyebrow">Live · 5-minute buckets</span><h3>{title}</h3></div><div className="operations-chart-legend">{series.map((item) => <span key={item.label}><i style={{ backgroundColor: item.color }} />{item.label}</span>)}</div></header>
      {labels.length ? (
        <>
          <svg className="operations-line-chart" viewBox="0 0 600 218" role="img" aria-label={`${title} over the last hour`}>
            {[38, 82, 126, 170].map((y) => <line key={y} x1="34" x2="566" y1={y} y2={y} className="operations-chart-gridline" />)}
            {series.map((item, seriesIndex) => <g key={item.label}>
              <polyline points={coordinates[seriesIndex].map(({ x, y }) => `${x},${y}`).join(' ')} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {coordinates[seriesIndex].map(({ x, y }, index) => <circle key={`${item.label}-${index}`} cx={x} cy={y} r="3.5" fill={item.color}><title>{labels[index]} · {item.label}: {item.values[index]}</title></circle>)}
            </g>)}
          </svg>
          <div className="operations-chart-axis"><span>{labels[0]}</span><span>{labels[Math.floor((labels.length - 1) / 2)]}</span><span>{labels.at(-1)}</span></div>
        </>
      ) : <p className="operations-chart-empty">Traffic history is unavailable.</p>}
    </article>
  )
}

function OperationsDonut({ title, entries }: { title: string; entries: { label: string; value: number; color: string }[] }) {
  const total = entries.reduce((sum, entry) => sum + entry.value, 0)
  let accumulated = 0
  const stops = entries.map((entry) => {
    const start = total ? (accumulated / total) * 100 : 0
    accumulated += entry.value
    return `${entry.color} ${start}% ${(accumulated / total) * 100}%`
  })

  return (
    <article className="operations-chart-panel operations-donut-panel">
      <header><div><span className="operations-eyebrow">Request telemetry</span><h3>{title}</h3></div><strong>{total || '—'}</strong></header>
      <div className="operations-donut-layout">
        <div className={`operations-donut${total ? '' : ' is-empty'}`} style={{ background: total ? `conic-gradient(${stops.join(', ')})` : undefined }} role="img" aria-label={total ? `${title}, ${total} total` : `${title} unavailable`}><span>{total || '—'}</span></div>
        <ul>{entries.map((entry) => <li key={entry.label}><i style={{ backgroundColor: entry.color }} /><span>{entry.label}</span><strong>{total ? entry.value : '—'}</strong></li>)}</ul>
      </div>
    </article>
  )
}

function OperationsBars({ title, items }: { title: string; items: { label: string; value: number }[] }) {
  const maximum = Math.max(1, ...items.map((item) => item.value))
  return (
    <article className="operations-chart-panel">
      <header><div><span className="operations-eyebrow">Request telemetry</span><h3>{title}</h3></div><strong>{items.length || '—'}</strong></header>
      {items.length ? <div className="operations-horizontal-bars">{items.map((item) => <div key={item.label}><span title={item.label}>{item.label}</span><div><i style={{ width: `${Math.max(3, (item.value / maximum) * 100)}%` }} /></div><strong>{item.value}</strong></div>)}</div> : <p className="operations-chart-empty">No request samples in this window.</p>}
    </article>
  )
}

function OperationsLogin({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)

    try {
      await operationsApi('/api/v1/operations/login', {
        method: 'POST',
        body: JSON.stringify({ email: String(form.get('email')), password: String(form.get('password')) }),
      })
      await onAuthenticated()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Operations sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="operations-login-page">
      <form className="operations-login-form" onSubmit={(event) => void submit(event)}>
        <span className="operations-eyebrow">Separate operations identity</span>
        <h1>IT operations sign in</h1>
        <p>This account is separate from the storefront and admin session controls.</p>

        <label>Operations email<input name="email" type="email" autoComplete="username" maxLength={254} required /></label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            required
          />
        </label>

        {error && <p className="operations-error" role="alert">{error}</p>}

        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Sign in to operations'}</button>
        <a href="/">Return to storefront</a>
      </form>
    </main>
  )
}

function OperationsConsole() {
  const queryClient = useQueryClient()
  const [activeModule, setActiveModule] = useState<ModuleKey>('overview')
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [error, setError] = useState('')
  const [findingSearch, setFindingSearch] = useState('')
  const [findingSeverity, setFindingSeverity] = useState('ALL')
  const [securityActionError, setSecurityActionError] = useState('')
  const [securityActionBusy, setSecurityActionBusy] = useState(false)
  const [permissionsError, setPermissionsError] = useState('')
  const [permissionsBusy, setPermissionsBusy] = useState(false)

  const permissionsQuery = useQuery({
    queryKey: ['operations', 'permissions'],
    queryFn: async () => (await operationsApi<OperationsPermissions>('/api/v1/operations/permissions')).data!,
    retry: false,
  })

  const securityOverviewQuery = useQuery({
    queryKey: ['operations', 'security-overview'],
    queryFn: async () => (await operationsApi<SecurityOverview>('/api/v1/operations/security/overview')).data!,
    refetchInterval: 10_000,
    retry: false,
  })
  const securityFindingsQuery = useQuery({
    queryKey: ['operations', 'security-findings'],
    queryFn: async () => (await operationsApi<SecurityFinding[]>('/api/v1/operations/security/findings')).data ?? [],
    refetchInterval: 15_000,
    retry: false,
  })
  const securityScannersQuery = useQuery({
    queryKey: ['operations', 'security-scanners'],
    queryFn: async () => (await operationsApi<SecurityScanner[]>('/api/v1/operations/security/scanners')).data ?? [],
    retry: false,
  })
  const securityScansQuery = useQuery({
    queryKey: ['operations', 'security-scans'],
    queryFn: async () => (await operationsApi<SecurityScan[]>('/api/v1/operations/security/scans')).data ?? [],
    refetchInterval: 5_000,
    retry: false,
  })

  const overviewQuery = useQuery({
    queryKey: ['operations', 'overview'],
    queryFn: async () => (await operationsApi<OperationsOverview>('/api/v1/operations/overview')).data!,
    refetchInterval: 30_000,
    retry: false,
  })

  const detectionsQuery = useQuery({
    queryKey: ['operations', 'detections'],
    queryFn: async () => (await operationsApi<MonitoringRule[]>('/api/v1/operations/detections')).data ?? [],
    refetchInterval: 30_000,
    retry: false,
  })

  const alertsQuery = useQuery({
    queryKey: ['operations', 'alerts'],
    queryFn: async () => (await operationsApi<MonitoringAlert[]>('/api/v1/operations/alerts?limit=25')).data ?? [],
    refetchInterval: 30_000,
    retry: false,
  })

  const workersQuery = useQuery({
    queryKey: ['operations', 'workers'],
    queryFn: async () => (await operationsApi<MonitoringWorker[]>('/api/v1/operations/workers')).data ?? [],
    refetchInterval: 30_000,
    retry: false,
  })

  const monitoringHealthQuery = useQuery({
    queryKey: ['operations', 'monitoring-health'],
    queryFn: async () => (await operationsApi<MonitoringHealth>('/api/v1/operations/health')).data!,
    refetchInterval: 30_000,
    retry: false,
  })

  const databasePerformanceQuery = useQuery({
    queryKey: ['operations', 'database-performance'],
    queryFn: async () => (await operationsApi<DatabasePerformance>('/api/v1/operations/database-performance')).data!,
    refetchInterval: 30_000,
    retry: false,
  })

  const runtimePerformanceQuery = useQuery({
    queryKey: ['operations', 'runtime-performance'],
    queryFn: async () => (await operationsApi<RuntimePerformance>('/api/v1/operations/runtime-performance')).data!,
    refetchInterval: 30_000,
    retry: false,
  })

  const providerPerformanceQuery = useQuery({
    queryKey: ['operations', 'provider-performance'],
    queryFn: async () => (await operationsApi<ProviderPerformance>('/api/v1/operations/provider-performance')).data!,
    refetchInterval: 60_000,
    retry: false,
  })

  const incidentsQuery = useQuery({
    queryKey: ['operations', 'incidents'],
    queryFn: async () => (await operationsApi<Incident[]>('/api/v1/operations/incidents?limit=25')).data ?? [],
    retry: false,
  })

  const auditQuery = useQuery({
    queryKey: ['operations', 'audit'],
    queryFn: async () => (await operationsApi<OperationsAudit[]>('/api/v1/operations/audit?limit=25')).data ?? [],
    retry: false,
  })

  const operatorsQuery = useQuery({
    queryKey: ['operations', 'operators'],
    queryFn: async () => (await operationsApi<OperationsUser[]>('/api/v1/operations/operators')).data ?? [],
    retry: false,
  })

  const incidents = incidentsQuery.data ?? []
  const audits = auditQuery.data ?? []
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) ?? null

  const eventsQuery = useQuery({
    queryKey: ['operations', 'incident-events', selectedIncidentId],
    queryFn: async () => (await operationsApi<IncidentEvent[]>(`/api/v1/operations/incidents/${selectedIncidentId}/events`)).data ?? [],
    enabled: selectedIncidentId !== null,
    retry: false,
  })

  useEffect(() => {
    if (sessionExpired) return

    const idleTimeoutMs = 20 * 60_000
    const keepAliveThrottleMs = 30_000
    let idleTimer = 0
    let lastKeepAlive = 0
    let signingOut = false

    const expireSession = () => {
      if (signingOut) return
      signingOut = true
      void operationsApi('/api/v1/operations/logout', { method: 'POST' }).catch(() => undefined)
      setSessionExpired(true)
    }

    const recordActivity = () => {
      if (signingOut) return
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(expireSession, idleTimeoutMs)

      const now = Date.now()
      if (now - lastKeepAlive < keepAliveThrottleMs) return
      lastKeepAlive = now

      void operationsApi('/api/v1/operations/session/activity', { method: 'POST' }).catch((issue: unknown) => {
        if (issue instanceof OperationsApiError && issue.status === 401) expireSession()
      })
    }

    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    activityEvents.forEach((name) => window.addEventListener(name, recordActivity, { passive: true }))
    recordActivity()

    return () => {
      window.clearTimeout(idleTimer)
      activityEvents.forEach((name) => window.removeEventListener(name, recordActivity))
    }
  }, [sessionExpired])

  async function createIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError('')

    try {
      const result = await operationsApi<{ id: number }>('/api/v1/operations/incidents', {
        method: 'POST',
        body: JSON.stringify({
          severity: String(form.get('severity')),
          affectedComponent: String(form.get('affectedComponent')),
          title: String(form.get('title')),
          description: String(form.get('description')),
        }),
      })

      setSelectedIncidentId(result.data?.id ?? null)
      event.currentTarget.reset()
      await queryClient.invalidateQueries({ queryKey: ['operations', 'incidents'] })
      await queryClient.invalidateQueries({ queryKey: ['operations', 'overview'] })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Incident could not be created.')
    }
  }

  async function updateIncident(incident: Incident, patch: Record<string, unknown>) {
    setError('')
    try {
      await operationsApi(`/api/v1/operations/incidents/${incident.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      await queryClient.invalidateQueries({ queryKey: ['operations', 'incidents'] })
      await queryClient.invalidateQueries({ queryKey: ['operations', 'incident-events', incident.id] })
      await queryClient.invalidateQueries({ queryKey: ['operations', 'overview'] })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Incident could not be updated.')
    }
  }

  async function updateAlert(alert: MonitoringAlert, status: 'acknowledged' | 'investigating' | 'resolved') {
    setError('')
    try {
      await operationsApi(`/api/v1/operations/alerts/${alert.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      await queryClient.invalidateQueries({ queryKey: ['operations', 'alerts'] })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Alert could not be updated.')
    }
  }

  async function saveIncidentResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedIncident) return
    const form = new FormData(event.currentTarget)
    await updateIncident(selectedIncident, {
      rootCause: String(form.get('rootCause') ?? '').trim() || null,
      resolutionNotes: String(form.get('resolutionNotes') ?? '').trim() || null,
    })
  }

  async function signOut() {
    setSessionExpired(true)
    try {
      await operationsApi('/api/v1/operations/logout', { method: 'POST' })
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['operations'] })
    }
  }

  function downloadSecurityReport() {
    const reportHtml = buildSecurityReportHtml(overviewQuery.data, new Date())
    const reportBlob = new Blob([reportHtml], { type: 'text/html;charset=utf-8' })
    const reportUrl = URL.createObjectURL(reportBlob)
    const link = document.createElement('a')
    link.href = reportUrl
    link.download = `kitculture-security-report-${new Date().toISOString().slice(0, 10)}.html`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(reportUrl), 1000)
  }

  function printSecurityReport() {
    const reportWindow = window.open('', '_blank')
    if (!reportWindow) {
      setError('The report window was blocked. Allow pop-ups for this site and try again.')
      return
    }
    reportWindow.opener = null
    reportWindow.document.open()
    reportWindow.document.write(buildSecurityReportHtml(overviewQuery.data, new Date()))
    reportWindow.document.close()
    reportWindow.addEventListener('load', () => reportWindow.print(), { once: true })
  }

  if (sessionExpired || (overviewQuery.error instanceof OperationsApiError && overviewQuery.error.status === 401)) {
    return <OperationsLogin onAuthenticated={async () => { setSessionExpired(false); await queryClient.invalidateQueries({ queryKey: ['operations'] }) }} />
  }

  const overview = overviewQuery.data
  const detectionRules = detectionsQuery.data ?? []
  const monitoringAlerts = alertsQuery.data ?? []
  const monitoringWorkers = workersQuery.data ?? []
  const monitoringHealth = monitoringHealthQuery.data
  const databasePerformance = databasePerformanceQuery.data
  const runtimePerformance = runtimePerformanceQuery.data
  const providerPerformance = providerPerformanceQuery.data
  const databaseQueryMetrics = databasePerformance?.metrics.filter((metric) => metric.metricType === 'database.query.completed') ?? []
  const databaseQuerySampleCount = databaseQueryMetrics.reduce((total, metric) => total + metric.sampleCount, 0)
  const databaseSlowCount = databaseQueryMetrics.reduce((total, metric) => total + metric.slowCount, 0)
  const databaseFailureCount = databasePerformance?.metrics.reduce((total, metric) => total + metric.failureCount, 0) ?? 0
  const databaseOperationLatencyBars = (databasePerformance?.metrics ?? []).map((metric) => ({
    label: `${label(metric.metricType.replace('database.', ''))} · ${metric.operation}`,
    value: metric.averageDurationMs,
  }))
  const databaseOperationOutcomes = [
    { label: 'Successful', value: databasePerformance?.metrics.reduce((total, metric) => total + metric.successCount, 0) ?? 0, color: '#62c89a' },
    { label: 'Failed', value: databaseFailureCount, color: '#ef7777' },
  ]
  const providerMetricsByName = new Map((providerPerformance?.metrics ?? []).map((metric) => [metric.provider, metric]))
  const unresolvedMonitoringAlerts = monitoringAlerts.filter((alert) => !['resolved', 'closed'].includes(alert.status))
  const requestSamples = overview?.requests.requestCount ?? 0
  const requestSuccessRate = overview && requestSamples > 0
    ? Number((100 * overview.requests.successfulRequestCount / requestSamples).toFixed(1))
    : null
  const requestErrorRate = overview && requestSamples > 0
    ? Number((100 * overview.requests.errorCount / requestSamples).toFixed(1))
    : null
  const averageRequestRate = overview?.requests.requestRatePerSecond
    ?? (overview ? Number((overview.requests.requestsLastMinute / 60).toFixed(2)) : null)
  const securitySignalCount = overview?.requests.securitySignalCount ?? 0
  const threatSignalScore = requestSamples
    ? Number((10 * securitySignalCount / requestSamples).toFixed(1))
    : null
  const threatPosture = { label: threatSignalScore === null ? 'Unavailable' : `${threatSignalScore}/10`, tone: 'threat-unknown' }
  const topEndpoints = overview?.requests.endpoints.slice(0, 5) ?? []
  const timeline = overview?.requests.timeline ?? []
  const timelineLabels = timeline.map((bucket) => new Date(bucket.bucketStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
  const requestSeries = timeline.map((bucket) => bucket.requestCount)
  const responseTimeSeries = timeline.flatMap((bucket) => bucket.averageResponseMs === null ? [] : [bucket.averageResponseMs])
  const securitySeries = timeline.map((bucket) => bucket.securitySignalCount)
  const methodBars = (overview?.requests.methods ?? []).map(({ method, requests }) => ({ label: method, value: requests }))
  const endpointBars = topEndpoints.map(({ endpoint, requests }) => ({ label: endpoint, value: requests }))
  const databaseLatencyBars = (overview?.databases ?? []).flatMap((database) => database.latencyMs === null ? [] : [{ label: label(database.name), value: database.latencyMs }])
  const responseMix = [
    { label: '2xx', value: overview?.requests.responseDistribution.success ?? 0, color: '#62c89a' },
    { label: '3xx', value: overview?.requests.responseDistribution.redirect ?? 0, color: '#70b5f5' },
    { label: '4xx', value: overview?.requests.responseDistribution.clientError ?? 0, color: '#f1bf63' },
    { label: '5xx', value: overview?.requests.responseDistribution.serverError ?? 0, color: '#ef7777' },
  ]
  const securityConfigurationContent = (
    <>
      <div className="operations-masthead">
        <div>
          <span className="operations-eyebrow">Security configuration center · read-only</span>
          <h2>Protection status and safe controls</h2>
          <p>Review verified safeguards and open protected investigation views. This center does not change production policy, accounts, or secrets.</p>
        </div>
        <span className="operations-threat-pill threat-unknown">No rule engine</span>
      </div>
      <section className="operations-stat-grid">
        <article className="operations-stat-card"><span>Operations access</span><strong>Session-gated</strong><small>Protected operations API</small></article>
        <article className="operations-stat-card"><span>Origin validation</span><strong>Enabled</strong><small>Cross-origin mutations checked</small></article>
        <article className="operations-stat-card"><span>API throttling</span><strong>Enabled</strong><small>Application rate limits active</small></article>
        <article className="operations-stat-card"><span>Threat rules</span><strong>Unavailable</strong><small>No detection rule feed configured</small></article>
      </section>
      <section className="operations-panel-card full-span operations-security-shortcuts">
        <header><span className="operations-eyebrow">Protected destinations</span><h3>Review a security area</h3></header>
        <div className="operations-security-shortcut-grid">
          {[
            { key: 'security' as const, label: 'Security Centre', detail: 'Observed request status signals' },
            { key: 'threat-detection' as const, label: 'Threat Detection', detail: 'No detection rule engine configured' },
            { key: 'identity-access' as const, label: 'Identity and Access', detail: 'Review role governance' },
            { key: 'vulnerabilities' as const, label: 'Vulnerabilities', detail: 'Scanner feed unavailable' },
            { key: 'incidents' as const, label: 'Incidents', detail: 'Investigate and record events' },
            { key: 'audit' as const, label: 'Audit Logs', detail: 'Review privileged operations' },
          ].map((destination) => <button type="button" key={destination.key} onClick={() => setActiveModule(destination.key)}><span><strong>{destination.label}</strong><small>{destination.detail}</small></span><ArrowRight size={15} /></button>)}
        </div>
      </section>
      <section className="operations-charts-grid">
        <OperationsLineChart title="Security-related HTTP responses" labels={timelineLabels} series={[{ label: '401 · 403 · 429', color: '#ed7b7b', values: securitySeries }]} />
        <OperationsDonut title="Request security-signal share" entries={[
          { label: '401 / 403 / 429', value: securitySignalCount, color: '#ed7b7b' },
          { label: 'Other responses', value: Math.max(0, requestSamples - securitySignalCount), color: '#73c7ff' },
        ]} />
      </section>
      <p className="operations-chart-footnote">Status codes are indicators only. No account blocking, IP blocking, secret changes, or production policy edits are available here.</p>
    </>
  )

  const moduleContent: Record<ModuleKey, ReactNode> = {
    overview: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Live overview</span>
            <h2>Platform status</h2>
            <p>Application telemetry, request health, and protected service signals.</p>
          </div>
          <span className={`operations-threat-pill ${threatPosture.tone}`}>Request signal index · {threatPosture.label}</span>
        </div>

        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Requests, last minute</span><strong>{overview?.requests.requestsLastMinute ?? 'Unavailable'}</strong><small>Latest minute</small></article>
          <article className="operations-stat-card"><span>Average throughput</span><strong>{averageRequestRate === null ? 'Unavailable' : `${averageRequestRate} req/s`}</strong><small>Selected one-hour window</small></article>
          <article className="operations-stat-card"><span>HTTP errors</span><strong>{overview?.requests.errorCount ?? 'Unavailable'}</strong><small>4xx + 5xx</small></article>
          <article className="operations-stat-card"><span>HTTP error rate</span><strong>{requestErrorRate === null ? 'Unavailable' : `${requestErrorRate}%`}</strong><small>4xx + 5xx over the window</small></article>
          <article className="operations-stat-card"><span>Successful responses</span><strong>{requestSuccessRate === null ? 'Unavailable' : `${requestSuccessRate}%`}</strong><small>Responses below 400</small></article>
          <article className="operations-stat-card"><span>Average response</span><strong>{overview?.requests.averageResponseMs == null ? 'Unavailable' : `${overview.requests.averageResponseMs} ms`}</strong><small>One-hour window</small></article>
          <article className="operations-stat-card"><span>P50 / P95 / P99</span><strong>{overview?.requests.p50ResponseMs == null || overview.requests.p95ResponseMs == null || overview.requests.p99ResponseMs == null ? 'Unavailable' : `${overview.requests.p50ResponseMs} / ${overview.requests.p95ResponseMs} / ${overview.requests.p99ResponseMs} ms`}</strong><small>Raw response-time distribution</small></article>
        </div>

        <section className="operations-charts-grid">
          <OperationsLineChart title="Requests per 5 minutes" labels={timelineLabels} series={[{ label: 'Requests', color: '#73c7ff', values: requestSeries }]} />
          <OperationsDonut title="HTTP response mix" entries={responseMix} />
          <OperationsBars title="Traffic by request method" items={methodBars} />
          <OperationsBars title="Requests by endpoint" items={endpointBars} />
          <OperationsBars title="Current database probe latency · ms" items={databaseLatencyBars} />

          <article className="operations-panel-card">
            <header>
              <span className="operations-eyebrow">Traffic</span>
              <h3>Top endpoints</h3>
            </header>
            <div className="operations-bar-list">
              {topEndpoints.length ? (
                topEndpoints.map((metric) => (
                  <div key={metric.endpoint} className="operations-bar-row">
                    <div className="operations-bar-meta">
                      <span>{metric.endpoint}</span>
                      <strong>{metric.requests}</strong>
                    </div>
                    <div className="operations-bar-track"><i style={{ width: `${clampPercent((metric.requests / Math.max(topEndpoints[0]?.requests ?? 1, 1)) * 100, 12, 100)}%` }} /></div>
                  </div>
                ))
              ) : (
                <p className="operations-empty-notice">No endpoint traffic has been recorded yet.</p>
              )}
            </div>
          </article>

          <article className="operations-panel-card">
            <header>
              <span className="operations-eyebrow">System</span>
              <h3>Database and process health</h3>
            </header>
            <div className="operations-mini-list">
              {(overview?.databases ?? []).map((database) => (
                <div key={database.name} className="operations-mini-item">
                  <span>{label(database.name)} database</span>
                  <strong className={database.status === 'healthy' ? 'status-ok' : 'status-alert'}>{database.status}</strong>
                  <small>{database.latencyMs === null ? 'Latency unavailable' : `${database.latencyMs} ms`}</small>
                </div>
              ))}
              <div className="operations-mini-item">
                <span>Memory footprint</span>
                <strong>{formatBytes(overview?.application.memoryRssBytes ?? 0)}</strong>
                <small>Heap {formatBytes(overview?.application.heapUsedBytes ?? 0)}</small>
              </div>
            </div>
          </article>
        </section>
      </>
    ),
    traffic: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Traffic analytics</span>
            <h2>Application traffic overview</h2>
            <p>Server-side request telemetry and route-level health.</p>
          </div>
        </div>
        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Requests / min</span><strong>{overview?.requests.requestsLastMinute ?? 'Unavailable'}</strong><small>Most recent minute</small></article>
          <article className="operations-stat-card"><span>Average throughput</span><strong>{averageRequestRate === null ? 'Unavailable' : `${averageRequestRate} req/s`}</strong><small>Selected one-hour window</small></article>
          <article className="operations-stat-card"><span>Failed requests</span><strong>{overview?.requests.errorCount ?? 'Unavailable'}</strong><small>4xx + 5xx</small></article>
          <article className="operations-stat-card"><span>HTTP error rate</span><strong>{requestErrorRate === null ? 'Unavailable' : `${requestErrorRate}%`}</strong><small>4xx + 5xx over the window</small></article>
          <article className="operations-stat-card"><span>Average response</span><strong>{overview?.requests.averageResponseMs == null ? 'Unavailable' : `${overview.requests.averageResponseMs} ms`}</strong><small>Selected window</small></article>
          <article className="operations-stat-card"><span>P50</span><strong>{overview?.requests.p50ResponseMs == null ? 'Unavailable' : `${overview.requests.p50ResponseMs} ms`}</strong><small>Median response</small></article>
          <article className="operations-stat-card"><span>P95</span><strong>{overview?.requests.p95ResponseMs == null ? 'Unavailable' : `${overview.requests.p95ResponseMs} ms`}</strong><small>Response distribution</small></article>
          <article className="operations-stat-card"><span>P99</span><strong>{overview?.requests.p99ResponseMs == null ? 'Unavailable' : `${overview.requests.p99ResponseMs} ms`}</strong><small>Tail latency</small></article>
          <article className="operations-stat-card"><span>Security signal index</span><strong>{threatPosture.label}</strong><small>Heuristic from 401/403/429 responses</small></article>
        </div>
        <section className="operations-charts-grid">
          <OperationsLineChart title="Incoming requests and errors" labels={timelineLabels} series={[
            { label: 'Requests', color: '#73c7ff', values: requestSeries },
            { label: 'Errors', color: '#ed7b7b', values: timeline.map((bucket) => bucket.errorCount) },
          ]} />
          <OperationsLineChart title="Response-time trend" labels={timelineLabels.filter((_, index) => timeline[index].averageResponseMs !== null)} series={[
            { label: 'Average ms', color: '#f0bd62', values: responseTimeSeries },
          ]} />
          <OperationsDonut title="HTTP status distribution" entries={responseMix} />
          <OperationsBars title="Popular API routes" items={endpointBars} />
          <OperationsBars title="Traffic by request method" items={methodBars} />
        </section>
        <p className="operations-chart-footnote">Actual application requests only · last 60-minute sample · collected {overview?.requests.collectedAt ? new Date(overview.requests.collectedAt).toLocaleTimeString() : '—'}.</p>
        <article className="operations-panel-card full-span">
          <header>
            <span className="operations-eyebrow">Endpoint activity</span>
            <h3>Highest-volume routes</h3>
          </header>
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead><tr><th>Route</th><th>Requests</th><th>Errors</th><th>Avg</th></tr></thead>
              <tbody>
                {topEndpoints.length ? (
                  topEndpoints.map((metric) => (
                    <tr key={metric.endpoint}><td>{metric.endpoint}</td><td>{metric.requests}</td><td>{metric.errors}</td><td>{metric.averageResponseMs} ms</td></tr>
                  ))
                ) : (
                  <tr><td colSpan={4}>No endpoint telemetry is available yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </>
    ),
    observability: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Observability</span>
            <h2>Application logs and runtime traces</h2>
            <p>Request correlation and runtime diagnostics are surfaced here.</p>
          </div>
        </div>
        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Uptime</span><strong>{overview ? formatDuration(overview.application.uptimeSeconds) : 'Unavailable'}</strong><small>Node {overview?.application.nodeVersion ?? 'unknown'}</small></article>
          <article className="operations-stat-card"><span>Process CPU</span><strong>{runtimePerformance?.processCpuAveragePercent == null ? 'Unavailable' : `${runtimePerformance.processCpuAveragePercent}%`}</strong><small>{runtimePerformance?.processCpuP95Percent == null ? 'P95 unavailable' : `P95 ${runtimePerformance.processCpuP95Percent}% · RSS ${runtimePerformance.processRssAverageBytes == null ? 'unavailable' : formatBytes(runtimePerformance.processRssAverageBytes)}`}</small></article>
          <article className="operations-stat-card"><span>Errors</span><strong>{overview?.requests.errorCount ?? 'Unavailable'}</strong><small>Persistent request failures</small></article>
          <article className="operations-stat-card"><span>Event loop</span><strong>{runtimePerformance?.eventLoopUtilizationAveragePercent == null ? 'Unavailable' : `${runtimePerformance.eventLoopUtilizationAveragePercent}%`}</strong><small>{runtimePerformance?.eventLoopP95DelaySampleMaxMs == null ? 'Delay unavailable' : `Max sample P95 delay ${runtimePerformance.eventLoopP95DelaySampleMaxMs} ms`}</small></article>
        </div>
        <section className="operations-charts-grid">
          <OperationsLineChart title="Request errors over time" labels={timelineLabels} series={[{ label: 'Errors', color: '#ed7b7b', values: timeline.map((bucket) => bucket.errorCount) }]} />
          <OperationsLineChart title="Average response time" labels={timelineLabels.filter((_, index) => timeline[index].averageResponseMs !== null)} series={[{ label: 'Milliseconds', color: '#f0bd62', values: responseTimeSeries }]} />
        </section>
        <section className="operations-panel-card full-span">
          <header><span className="operations-eyebrow">Monitoring pipeline</span><h3>Collection and worker health</h3></header>
          {monitoringHealthQuery.isError ? <div className="operations-empty">Monitoring health is unavailable: {monitoringHealthQuery.error.message}</div> : (
            <div className="operations-stat-grid">
              <article className="operations-stat-card"><span>Telemetry freshness</span><strong>{monitoringHealth?.telemetryFreshness ?? 'Loading'}</strong><small>{monitoringHealth?.queue.lastPersistedAt ? `Last stored ${new Date(monitoringHealth.queue.lastPersistedAt).toLocaleString()}` : 'No persisted event yet'}</small></article>
              <article className="operations-stat-card"><span>Queue depth</span><strong>{monitoringHealth?.queue.queueDepth ?? '—'}</strong><small>{monitoringHealth?.queue.droppedEvents ?? 0} dropped · {monitoringHealth?.queue.storageFailures ?? 0} storage failures</small></article>
              <article className="operations-stat-card"><span>Events persisted</span><strong>{monitoringHealth?.queue.persistedEvents ?? '—'}</strong><small>Since this process started</small></article>
              <article className="operations-stat-card"><span>Worker failures</span><strong>{workersQuery.isError ? 'Unavailable' : monitoringWorkers.reduce((total, worker) => total + worker.failureCount, 0)}</strong><small>Current stored worker counters</small></article>
            </div>
          )}
        </section>
        <p className="operations-chart-footnote">CPU and memory values are Node process measurements, not host totals. Host CPU/memory, disk and network metrics are unavailable from the current runtime integration.</p>
      </>
    ),
    security: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Security operations</span>
            <h2>Authentication and access posture</h2>
            <p>Security events remain protected by the same role-based controls as the admin shell.</p>
          </div>
        </div>
        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Request signal index</span><strong>{threatPosture.label}</strong><small>Heuristic, not a threat verdict</small></article>
          <article className="operations-stat-card"><span>401 / 403 signals</span><strong>{overview?.requests.securitySignalCount ?? 0}</strong><small>{overview?.requests.telemetryFreshness === 'process_local_fallback' ? 'Local fallback · includes 429' : 'Persisted HTTP signals · includes 429'}</small></article>
          <article className="operations-stat-card"><span>Rate limiting</span><strong>Enabled</strong><small>API and auth throttling applied</small></article>
          <article className="operations-stat-card"><span>Audit trail</span><strong>Active</strong><small>Privileged actions are recorded</small></article>
        </div>
        <section className="operations-charts-grid">
          <OperationsLineChart title="Request security signals" labels={timelineLabels} series={[{ label: '401 · 403 · 429', color: '#ed7b7b', values: securitySeries }]} />
          <OperationsDonut title="Signal share in sampled requests" entries={[
            { label: '401 / 403 / 429', value: securitySignalCount, color: '#ed7b7b' },
            { label: 'Other responses', value: Math.max(0, requestSamples - securitySignalCount), color: '#73c7ff' },
          ]} />
        </section>
        <p className="operations-chart-footnote">These are HTTP status indicators only. They are not confirmed attacks, user identities, or automated blocking decisions.</p>
      </>
    ),
    'threat-detection': (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Threat detection</span>
            <h2>Detection rules and event posture</h2>
            <p>Threat indicators are tracked separately from confirmed incidents until validated.</p>
          </div>
        </div>
        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Detection rules</span><strong>{detectionsQuery.isError ? 'Unavailable' : detectionRules.length}</strong><small>{detectionRules.filter((rule) => rule.enabled).length} enabled</small></article>
          <article className="operations-stat-card"><span>Open alerts</span><strong>{alertsQuery.isError ? 'Unavailable' : unresolvedMonitoringAlerts.length}</strong><small>From the latest 25 stored alerts</small></article>
          <article className="operations-stat-card"><span>HTTP signals</span><strong>{overview?.requests.securitySignalCount ?? 'Unavailable'}</strong><small>401 / 403 / 429 responses only</small></article>
          <article className="operations-stat-card"><span>Request index</span><strong>{threatPosture.label}</strong><small>Heuristic, not a threat verdict</small></article>
        </div>
        <section className="operations-panel-card full-span">
          <header><span className="operations-eyebrow">Persisted configuration</span><h3>Detection rules</h3></header>
          {detectionsQuery.isError ? <div className="operations-empty">Detection rules are unavailable: {detectionsQuery.error.message}</div> : (
            <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Rule</th><th>Condition</th><th>Threshold</th><th>Window</th><th>Severity</th><th>State</th></tr></thead><tbody>
              {detectionRules.map((rule) => <tr key={rule.ruleId}><td><strong>{rule.name}</strong><br />{rule.description}</td><td>{label(rule.condition)}</td><td>{rule.threshold}</td><td>{rule.windowSeconds}s</td><td>{label(rule.severity)}</td><td>{rule.enabled ? 'Enabled' : 'Disabled'}</td></tr>)}
              {!detectionRules.length && <tr><td colSpan={6}>{detectionsQuery.isPending ? 'Loading detection rules…' : 'No persisted rules. Apply the monitoring migrations and start the worker.'}</td></tr>}
            </tbody></table></div>
          )}
        </section>
        <section className="operations-panel-card full-span">
          <header><span className="operations-eyebrow">Alert lifecycle</span><h3>Recent detected alerts</h3></header>
          {alertsQuery.isError ? <div className="operations-empty">Alerts are unavailable: {alertsQuery.error.message}</div> : (
            <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Severity</th><th>Rule and service</th><th>Occurrences</th><th>Status</th><th>Last seen</th><th>Actions</th></tr></thead><tbody>
              {monitoringAlerts.map((alert) => <tr key={alert.id}><td>{label(alert.severity)}</td><td><strong>{alert.ruleName}</strong><br />{alert.affectedService}<br />{alert.description}</td><td>{alert.occurrenceCount}</td><td>{label(alert.status)}</td><td>{new Date(alert.lastOccurrence).toLocaleString()}</td><td><div className="operations-report-actions">{alert.status === 'new' && <button type="button" className="operations-report-print" onClick={() => void updateAlert(alert, 'acknowledged')}>Acknowledge</button>}{['new', 'acknowledged'].includes(alert.status) && <button type="button" className="operations-report-print" onClick={() => void updateAlert(alert, 'investigating')}>Investigate</button>}{!['resolved', 'closed'].includes(alert.status) && <button type="button" className="operations-report-download" onClick={() => void updateAlert(alert, 'resolved')}>Resolve</button>}</div></td></tr>)}
              {!monitoringAlerts.length && <tr><td colSpan={6}>{alertsQuery.isPending ? 'Loading alerts…' : 'No persisted alerts in the latest page.'}</td></tr>}
            </tbody></table></div>
          )}
        </section>
        <section className="operations-charts-grid"><OperationsLineChart title="Request security indicators" labels={timelineLabels} series={[{ label: 'Status signals', color: '#ed7b7b', values: securitySeries }]} /></section>
      </>
    ),
    vulnerabilities: (() => {
      const securityOverview = securityOverviewQuery.data
      const securityFindings = securityFindingsQuery.data ?? []
      const visibleFindings = securityFindings.filter((finding) => (findingSeverity === 'ALL' || finding.severity === findingSeverity) && (!findingSearch || `${finding.title} ${finding.affectedComponent}`.toLowerCase().includes(findingSearch.toLowerCase())))
      const startDependencyScan = async () => {
        setSecurityActionBusy(true)
        setSecurityActionError('')
        try {
          await operationsApi('/api/v1/operations/security/scans', { method: 'POST', body: JSON.stringify({ scope: ['dependency'] }) })
          await Promise.all([queryClient.invalidateQueries({ queryKey: ['operations', 'security-overview'] }), queryClient.invalidateQueries({ queryKey: ['operations', 'security-scans'] }), queryClient.invalidateQueries({ queryKey: ['operations', 'security-findings'] })])
        } catch (issue) {
          setSecurityActionError(issue instanceof OperationsApiError ? issue.message : 'Unable to start dependency scan.')
        } finally { setSecurityActionBusy(false) }
      }
      const activeSecurityScan = securityScansQuery.data?.find((scan) => ['queued', 'running'].includes(scan.status))
      const cancelSecurityScan = async (id: string) => {
        setSecurityActionBusy(true)
        try {
          await operationsApi(`/api/v1/operations/security/scans/${id}/cancel`, { method: 'POST' })
          await queryClient.invalidateQueries({ queryKey: ['operations', 'security-scans'] })
        } catch (issue) {
          setSecurityActionError(issue instanceof OperationsApiError ? issue.message : 'Unable to cancel security scan.')
        } finally { setSecurityActionBusy(false) }
      }
      return (
        <>
          <div className="operations-masthead">
            <div><span className="operations-eyebrow">Vulnerability management</span><h2>Findings and remediation</h2><p>Dependency telemetry is generated locally; unavailable scanners are never reported as clean.</p></div>
            <div className="operations-report-actions">
              {activeSecurityScan && <button type="button" className="operations-report-print" disabled={securityActionBusy} onClick={() => void cancelSecurityScan(activeSecurityScan.id)}>Cancel scan</button>}
              <button type="button" className="operations-report-download" disabled={securityActionBusy || Boolean(activeSecurityScan)} onClick={() => void startDependencyScan()}>{securityActionBusy ? 'Working…' : 'Run dependency scan'}</button>
            </div>
          </div>
          {securityActionError && <p className="operations-error" role="alert">{securityActionError}</p>}
          <div className="operations-stat-grid">
            <article className="operations-stat-card"><span>Findings</span><strong>{securityOverview?.findings ?? 'Unavailable'}</strong><small>{securityOverviewQuery.isError ? 'Scanner API unavailable' : 'Current unverified scan observations'}</small></article>
            <article className="operations-stat-card"><span>Critical + high</span><strong>{securityOverview ? securityOverview.severityCounts.CRITICAL + securityOverview.severityCounts.HIGH : 'Unavailable'}</strong><small>Verified severity only</small></article>
            <article className="operations-stat-card"><span>Last scan</span><strong>{securityOverview?.latestScan?.status ?? 'None'}</strong><small>{securityOverview?.latestScan?.completedAt ? new Date(securityOverview.latestScan.completedAt).toLocaleString() : 'No completed scan'}</small></article>
            <article className="operations-stat-card"><span>Dependency coverage</span><strong>{securityOverview?.coverage.dependency ? 'Available' : 'Unknown'}</strong><small>npm audit integration</small></article>
          </div>
          <section className="operations-panel-card full-span">
            <header><span className="operations-eyebrow">Scanner status</span><h3>Assessment coverage</h3></header>
            {securityScannersQuery.isError ? <div className="operations-empty">Scanner status is unavailable.</div> : <div className="operations-mini-grid">
              {(securityScannersQuery.data ?? []).map((scanner) => <article className="operations-mini-item" key={scanner.scanner}><span>{scanner.coverage}</span><strong>{scanner.scanner}</strong><small>{scanner.status === 'not_configured' ? 'Not configured' : scanner.status}</small></article>)}
            </div>}
          </section>
          <section className="operations-panel-card full-span">
            <header><span className="operations-eyebrow">Findings</span><h3>Dependency analysis</h3></header>
            <div className="operations-security-findings-controls"><label><Search size={13} /> <input value={findingSearch} onChange={(event) => setFindingSearch(event.target.value)} placeholder="Search package or finding" /></label><select value={findingSeverity} onChange={(event) => setFindingSeverity(event.target.value)} aria-label="Finding severity"><option value="ALL">All severities</option>{['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'].map((severity) => <option key={severity} value={severity}>{label(severity)}</option>)}</select></div>
            {securityFindingsQuery.isError ? <div className="operations-empty">Findings are unavailable.</div> : visibleFindings.length ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Severity</th><th>Finding</th><th>Affected package</th><th>Status</th><th>Remediation</th></tr></thead><tbody>{visibleFindings.map((finding) => <tr key={finding.id}><td>{finding.severity ? label(finding.severity) : 'UNASSESSED'}</td><td><strong>{finding.title}</strong><br /><small>{finding.description}</small></td><td>{finding.affectedComponent}</td><td>{finding.lifecycleStatus ?? 'OPEN'}</td><td>{finding.remediation}</td></tr>)}</tbody></table></div> : <div className="operations-empty">{securityFindingsQuery.isPending ? 'Loading findings…' : 'No findings matched this view.'}</div>}
          </section>
          <section className="operations-panel-card full-span">
            <header><span className="operations-eyebrow">Scan history</span><h3>Recent executions</h3></header>
            {securityScansQuery.data?.length ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Started</th><th>Status</th><th>Modules</th><th>Findings</th></tr></thead><tbody>{securityScansQuery.data.map((scan) => <tr key={scan.id}><td>{new Date(scan.startedAt).toLocaleString()}</td><td>{label(scan.status)}</td><td>{scan.modules.map((module) => module.module).join(', ')}</td><td>{scan.summary.findings ?? 0}</td></tr>)}</tbody></table></div> : <div className="operations-empty">No scans have been recorded.</div>}
          </section>
        </>
      )
    })(),
    'identity-access': (() => {
      const roleLabel = (role: ItAccessRole) => ({ super_admin: 'Super admin', security_analyst: 'Security analyst', it_support: 'IT support', database_admin: 'Database admin', infrastructure_admin: 'Infrastructure admin', viewer: 'Viewer' })[role]
      const updateRole = async (userId: number, role: ItAccessRole) => {
        setPermissionsBusy(true)
        setPermissionsError('')
        try {
          await operationsApi(`/api/v1/operations/permissions/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) })
          await queryClient.invalidateQueries({ queryKey: ['operations', 'permissions'] })
        } catch (issue) {
          setPermissionsError(issue instanceof OperationsApiError ? issue.message : 'The role could not be updated.')
        } finally { setPermissionsBusy(false) }
      }
      const permissionsData = permissionsQuery.data
      return (
        <>
          <div className="operations-masthead">
            <div><span className="operations-eyebrow">Identity and access</span><h2>Permissions and roles</h2><p>Role changes apply to operations sessions and are written to the audit log.</p></div>
            <div className="operations-report-actions"><button type="button" className="operations-report-print" disabled={permissionsQuery.isFetching} onClick={() => void permissionsQuery.refetch()}><RefreshCw size={13} /> Refresh</button></div>
          </div>
          <div className="operations-stat-grid">
            <article className="operations-stat-card"><span>Role model</span><strong>{permissionsData ? permissionsData.roles.length : 'Unavailable'}</strong><small>Fixed server allowlist</small></article>
            <article className="operations-stat-card"><span>Active operators</span><strong>{permissionsData ? permissionsData.users.length : 'Unavailable'}</strong><small>Operations identities</small></article>
            <article className="operations-stat-card"><span>Permissions</span><strong>{permissionsData ? permissionsData.permissions.length : 'Unavailable'}</strong><small>Enforced by the API</small></article>
            <article className="operations-stat-card"><span>Last super admin</span><strong>Protected</strong><small>Cannot be demoted or removed</small></article>
          </div>
          {permissionsError && <p className="operations-error" role="alert">{permissionsError}</p>}
          {permissionsQuery.isError ? <section className="operations-panel-card full-span"><div className="operations-empty">{permissionsQuery.error instanceof OperationsApiError && permissionsQuery.error.status === 403 ? 'Only an IT super-admin can manage roles.' : 'Role permissions are unavailable.'}</div></section> : permissionsQuery.isPending ? <section className="operations-panel-card full-span"><div className="operations-empty">Loading role governance…</div></section> : permissionsData && (
            <>
              <section className="operations-panel-card full-span">
                <header><span className="operations-eyebrow">Role assignments</span><h3>Operations users</h3></header>
                <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Last login</th><th>Action</th></tr></thead><tbody>{permissionsData.users.map((user) => <tr key={user.id}><td><strong>{user.fullName}</strong></td><td>{user.email ?? 'Unavailable'}</td><td><span className="operations-role-badge">{roleLabel(user.role ?? 'viewer')}</span></td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</td><td><select className="operations-role-select" aria-label={`Role for ${user.fullName}`} value={user.role ?? 'viewer'} disabled={permissionsBusy} onChange={(event) => void updateRole(user.id, event.target.value as ItAccessRole)}>{permissionsData.roles.map((role) => <option key={role.role} value={role.role}>{roleLabel(role.role)}</option>)}</select></td></tr>)}</tbody></table></div>
              </section>
              <section className="operations-panel-card full-span">
                <header><span className="operations-eyebrow">Permission matrix</span><h3>Role capabilities</h3></header>
                <div className="operations-role-grid">{permissionsData.roles.map((role) => <article className="operations-role-card" key={role.role}><div><span>{roleLabel(role.role)}</span><strong>{role.permissions.length} permissions</strong></div><p>{role.description}</p><ul>{role.permissions.map((permission) => <li key={permission}>{permission}</li>)}</ul></article>)}</div>
              </section>
            </>
          )}
        </>
      )
    })(),
    database: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Database operations</span>
            <h2>PostgreSQL and schema health</h2>
            <p>Only verified signals are surfaced; no arbitrary SQL is exposed in this view.</p>
          </div>
        </div>
        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Store DB</span><strong>{overview?.databases[0]?.status ?? 'unavailable'}</strong><small>{overview?.databases[0]?.latencyMs === null ? 'Probe unavailable' : `${overview?.databases[0]?.latencyMs ?? 0} ms`}</small></article>
          <article className="operations-stat-card"><span>Admin DB</span><strong>{overview?.databases[1]?.status ?? 'unavailable'}</strong><small>{overview?.databases[1]?.latencyMs === null ? 'Probe unavailable' : `${overview?.databases[1]?.latencyMs ?? 0} ms`}</small></article>
          <article className="operations-stat-card"><span>Pool usage</span><strong>{overview?.databasePool ? `${overview.databasePool.totalConnections}/${overview.databasePool.maxConnections ?? '—'}` : 'Unavailable'}</strong><small>{overview?.databasePool ? `${overview.databasePool.idleConnections} idle · ${overview.databasePool.waitingRequests} waiting` : 'Pool metrics not available'}</small></article>
          <article className="operations-stat-card"><span>Measured DB queries</span><strong>{databasePerformanceQuery.isError ? 'Unavailable' : databasePerformance?.telemetryAvailable ? databaseQuerySampleCount : 'No samples'}</strong><small>{databasePerformance?.telemetryAvailable ? `${databaseSlowCount} slow · ${databaseFailureCount} failed` : 'Persistent DB measurements pending'}</small></article>
        </div>
        <section className="operations-charts-grid">
          <OperationsBars title="Measured database operation latency · ms" items={databaseOperationLatencyBars} />
          <OperationsDonut title="Measured database operation outcomes" entries={databaseOperationOutcomes} />
        </section>
      </>
    ),
    payments: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Payment operations</span>
            <h2>M-Pesa and transaction posture</h2>
            <p>Payment data requires provider verification and approval before automated reconciliation.</p>
          </div>
        </div>
        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Daraja</span><strong>Unknown</strong><small>No provider health check configured</small></article>
          <article className="operations-stat-card"><span>Callbacks</span><strong>Unknown</strong><small>Waiting for live feed</small></article>
          <article className="operations-stat-card"><span>Reconciliation</span><strong>Guarded</strong><small>Requires explicit permission and audit</small></article>
          <article className="operations-stat-card"><span>Order status</span><strong>Protected</strong><small>No automatic mark-as-paid logic</small></article>
        </div>
      </>
    ),
    integrations: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Integrations</span>
            <h2>Connected service health</h2>
            <p>Only verified third-party sources are shown in the operations view.</p>
          </div>
        </div>
        <article className="operations-panel-card full-span">
          <header>
            <span className="operations-eyebrow">Service status</span>
            <h3>Dependency map</h3>
          </header>
          <div className="operations-mini-list">
            {monitoringHealthQuery.isError && <div className="operations-empty">Service health is unavailable: {monitoringHealthQuery.error.message}</div>}
            {providerPerformanceQuery.isError && <div className="operations-empty">Provider performance history is unavailable: {providerPerformanceQuery.error.message}</div>}
            {(providerPerformance?.integrations ?? []).map((integration) => {
              const measured = providerMetricsByName.get(integration.provider)
              return <div key={integration.provider} className="operations-mini-item"><span>{label(integration.provider)}</span><strong className="status-watch">{integration.health}</strong><small>{measured ? `${measured.requestCount} real requests · avg ${measured.averageDurationMs} ms · P95 ${measured.p95DurationMs ?? 'unavailable'} ms · ${measured.rejectedCount} rejected` : integration.reason}</small></div>
            })}
            {(monitoringHealth?.services ?? []).map((service) => (
              <div key={service.name} className="operations-mini-item"><span>{label(service.name)}</span><strong className={service.state === 'healthy' ? 'status-ok' : 'status-watch'}>{service.state}</strong><small>{service.source}{service.latencyMs == null ? '' : ` · ${service.latencyMs} ms`}</small></div>
            ))}
            {Object.entries(overview?.externalServices ?? {}).map(([service, status]) => (
              <div key={service} className="operations-mini-item">
                <span>{label(service)}</span>
                <strong className={status.status === 'unknown' ? 'status-watch' : 'status-ok'}>{status.status}</strong>
                <small>{status.reason ?? 'No known issue is currently reported.'}</small>
              </div>
            ))}
          </div>
        </article>
      </>
    ),
    incidents: (
      <div className="operations-incident-layout">
        <section className="operations-panel-card">
          <header>
            <span className="operations-eyebrow">Incident register</span>
            <h3>Open and recent incidents</h3>
          </header>

          {incidents.length === 0 ? (
            <div className="operations-empty">No incidents recorded yet.</div>
          ) : (
            incidents.map((incident) => (
              <button
                key={incident.id}
                type="button"
                className={`operations-incident-row${selectedIncidentId === incident.id ? ' is-selected' : ''}`}
                onClick={() => setSelectedIncidentId(incident.id)}
              >
                <span className={`operations-severity severity-${incident.severity.toLowerCase()}`}>{incident.severity}</span>
                <span className="operations-incident-copy">
                  <strong>{incident.title}</strong>
                  <small>{incident.incidentNumber} · {label(incident.status)} · {label(incident.affectedComponent)}</small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))
          )}

          <form className="operations-create-form" onSubmit={(event) => void createIncident(event)}>
            <h3>Open an incident</h3>
            <div className="operations-form-row">
              <label>
                Severity
                <select name="severity" defaultValue="P3">
                  <option>P1</option>
                  <option>P2</option>
                  <option>P3</option>
                  <option>P4</option>
                </select>
              </label>
              <label>
                Component
                <select name="affectedComponent" defaultValue="api">
                  <option value="website">Website</option>
                  <option value="api">API</option>
                  <option value="database">Database</option>
                  <option value="payments">Payments</option>
                  <option value="email">Email</option>
                  <option value="security">Security</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
            <label>Title<input name="title" required minLength={4} maxLength={160} /></label>
            <label>Description<textarea name="description" required minLength={10} maxLength={4000} rows={3} /></label>
            <button type="submit">Create incident</button>
          </form>
        </section>

        <section className="operations-panel-card operations-incident-detail">
          <header>
            <span className="operations-eyebrow">Incident detail</span>
            <h3>{selectedIncident?.incidentNumber ?? 'Select an incident'}</h3>
          </header>

          {selectedIncident ? (
            <>
              <h4>{selectedIncident.title}</h4>
              <p>{selectedIncident.description}</p>

              <div className="operations-incident-controls">
                <label>
                  Status
                  <select value={selectedIncident.status} onChange={(event) => void updateIncident(selectedIncident, { status: event.target.value })}>
                    <option value="open">Open</option>
                    <option value="investigating">Investigating</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <label>
                  Severity
                  <select value={selectedIncident.severity} onChange={(event) => void updateIncident(selectedIncident, { severity: event.target.value })}>
                    <option>P1</option>
                    <option>P2</option>
                    <option>P3</option>
                    <option>P4</option>
                  </select>
                </label>
                <label>
                  Assignee
                  <select value={selectedIncident.assignedOperationsUserId ?? ''} onChange={(event) => void updateIncident(selectedIncident, { assignedOperationsUserId: event.target.value ? Number(event.target.value) : null })}>
                    <option value="">Unassigned</option>
                    {(operatorsQuery.data ?? []).map((operator) => (
                      <option key={operator.id} value={operator.id}>{operator.fullName}</option>
                    ))}
                  </select>
                </label>
              </div>

              <form className="operations-note-form" onSubmit={(event) => void saveIncidentResolution(event)}>
                <label>Root cause<textarea key={`cause-${selectedIncident.id}`} name="rootCause" defaultValue={selectedIncident.rootCause ?? ''} rows={2} /></label>
                <label>Resolution notes<textarea key={`resolution-${selectedIncident.id}`} name="resolutionNotes" defaultValue={selectedIncident.resolutionNotes ?? ''} rows={2} /></label>
                <button type="submit">Save resolution details</button>
              </form>

              <div className="operations-timeline">
                {eventsQuery.isPending ? <p>Loading incident history…</p> : (eventsQuery.data ?? []).map((event) => (
                  <div key={event.id} className="operations-timeline-item">
                    <strong>{event.eventType}</strong>
                    <p>{event.message}</p>
                    <small>{new Date(event.createdAt).toLocaleString()} · {event.actorName ?? 'System'}</small>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>Please select an incident to review the timeline.</p>
          )}
        </section>
      </div>
    ),
    support: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">IT support</span>
            <h2>Ticketing workflow</h2>
            <p>Service desk functions are routed through the internal operations model.</p>
          </div>
        </div>
        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Open tickets</span><strong>0</strong><small>No active desk workflow configured</small></article>
          <article className="operations-stat-card"><span>SLA</span><strong>Manual</strong><small>Requires assignment and triage</small></article>
          <article className="operations-stat-card"><span>Escalation</span><strong>Policy-based</strong><small>Managed in the ticket workflow</small></article>
          <article className="operations-stat-card"><span>Routing</span><strong>Guarded</strong><small>Internal only</small></article>
        </div>
      </>
    ),
    backups: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Backups and recovery</span>
            <h2>Recovery readiness</h2>
            <p>Restore verification is tracked separately and only when a strong source is configured.</p>
          </div>
        </div>
        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Last backup</span><strong>Unavailable</strong><small>No safe backup provider configured</small></article>
          <article className="operations-stat-card"><span>Restore test</span><strong>Not started</strong><small>Requires staging verification</small></article>
          <article className="operations-stat-card"><span>Retention</span><strong>Policy</strong><small>Review required</small></article>
          <article className="operations-stat-card"><span>Approval</span><strong>Required</strong><small>Production actions remain guarded</small></article>
        </div>
      </>
    ),
    deployments: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Deployments</span>
            <h2>Release and environment tracking</h2>
            <p>Deployment status is only reported once hosting or provider integration is verified.</p>
          </div>
        </div>
        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Production</span><strong>Unknown</strong><small>No provider integration configured</small></article>
          <article className="operations-stat-card"><span>Staging</span><strong>Unknown</strong><small>No deploy event source connected</small></article>
          <article className="operations-stat-card"><span>Rollback</span><strong>Manual</strong><small>Approval required</small></article>
          <article className="operations-stat-card"><span>Review</span><strong>Guarded</strong><small>Production changes are not automatic</small></article>
        </div>
      </>
    ),
    reports: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Reporting</span>
            <h2>Website security report</h2>
            <p>Generated from the documented security assessment and the current protected operations snapshot.</p>
          </div>
        </div>
        <article className="operations-panel-card full-span operations-report-panel">
          <header><span className="operations-eyebrow">Portable report</span><h3>Current security posture</h3></header>
          <p>Includes the assessment findings, application request summary, current database probes, provider availability, and verification limitations. No credentials, full incident descriptions, or audit event details are exported.</p>
          <div className="operations-report-actions">
            <button type="button" className="operations-report-download" onClick={downloadSecurityReport}><Download size={15} /> Download HTML report</button>
            <button type="button" className="operations-report-print" onClick={printSecurityReport}><Printer size={15} /> Print / Save as PDF</button>
          </div>
          <p className="operations-chart-footnote">The report is a point-in-time snapshot. Open findings remain open and provider health is not inferred. Request telemetry reports its source and freshness.</p>
        </article>
        <article className="operations-panel-card full-span">
          <header><span className="operations-eyebrow">Coverage and limitations</span><h3>Source status</h3></header>
          <div className="operations-mini-list">
            <div className="operations-mini-item"><span>Security assessment</span><strong className="status-ok">Included</strong><small>2026-11-02 assessment findings reproduced as documented</small></div>
            <div className="operations-mini-item"><span>Application traffic</span><strong className={overview?.requests.telemetryFreshness === 'process_local_fallback' ? 'status-watch' : 'status-ok'}>{overview?.requests.telemetryFreshness === 'process_local_fallback' ? 'Local fallback' : 'Persistent events'}</strong><small>{overview?.requests.telemetryFreshness ?? 'Telemetry source unavailable'}</small></div>
            <div className="operations-mini-item"><span>Security events</span><strong className="status-watch">Partial</strong><small>401/403/429 status signals are not confirmed attacks</small></div>
            <div className="operations-mini-item"><span>Infrastructure, backups, payments</span><strong className="status-watch">Unverified</strong><small>Requires authorized provider checks</small></div>
          </div>
        </article>
      </>
    ),
    audit: (
      <article className="operations-panel-card full-span">
        <header>
          <span className="operations-eyebrow">Append-only record</span>
          <h3>Operations audit history</h3>
        </header>
        {auditQuery.isPending ? (
          <div className="operations-empty">Loading audit events…</div>
        ) : auditQuery.isError ? (
          <div className="operations-empty">{auditQuery.error.message}</div>
        ) : (
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
              <tbody>
                {audits.map((entry) => (
                  <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.actorName ?? label(entry.actorType)}</td><td>{label(entry.action)}</td><td>{entry.targetType} · {entry.targetId}</td><td>{entry.details ?? '—'}</td></tr>
                ))}
                {!audits.length && <tr><td colSpan={5}>No operations audit events yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </article>
    ),
    settings: securityConfigurationContent,
    'security-config': securityConfigurationContent,
  }

  return (
    <main className="operations-shell operations-shell-advanced">
      <aside className="operations-sidebar">
        <div className="operations-sidebar-brand">
          <img className="operations-brand-logo" src="/matrix-logo.png" alt="MATRIX" />
          <strong>Operations</strong>
        </div>

        {moduleGroups.map((group) => (
          <div key={group.label} className="operations-nav-group">
            <span>{group.label}</span>
            <nav>
              {group.items.map(({ key, label: itemLabel, icon: Icon, status }) => (
                <button
                  key={key}
                  type="button"
                  className={`operations-nav-item${activeModule === key ? ' is-active' : ''}`}
                  onClick={() => setActiveModule(key)}
                >
                  <Icon size={16} />
                  <span>{itemLabel}</span>
                  <small className={`status-badge ${status}`}>{status}</small>
                </button>
              ))}
            </nav>
          </div>
        ))}
      </aside>

      <section className="operations-main-panel">
        <header className="operations-main-header">
          <div>
            <span className="operations-eyebrow">Operations console</span>
            <h1>Operations centre</h1>
          </div>
          <div className="operations-main-actions">
            <button type="button" className="operations-icon-button" aria-label="Search"><Search size={15} /></button>
            <button type="button" className="operations-icon-button" aria-label="Notifications"><Bell size={15} /></button>
            <button type="button" className="operations-security-center-button" onClick={() => setActiveModule('security-config')}><Shield size={14} /> Security centre</button>
            <button type="button" className="operations-refresh" onClick={() => void overviewQuery.refetch()}><RefreshCw size={14} /> Refresh</button>
            <button type="button" className="operations-signout" onClick={() => void signOut()}><LogOut size={14} /> Sign out</button>
          </div>
        </header>

        {error && <p className="operations-error" role="alert"><AlertTriangle size={15} /> {error}</p>}
        {moduleContent[activeModule]}
      </section>
    </main>
  )
}

export function OperationsRoute() {
  const accessQuery = useQuery({
    queryKey: ['operations', 'access'],
    queryFn: async () => (await operationsApi<{ user: { id: number; email: string; fullName: string } }>('/api/v1/operations/me')).data,
    retry: false,
  })

  if (accessQuery.isPending) return <main className="operations-checking" role="status">Verifying operations access…</main>
  if (accessQuery.error instanceof OperationsApiError && accessQuery.error.status === 401) {
    return <OperationsLogin onAuthenticated={async () => { await accessQuery.refetch() }} />
  }
  if (accessQuery.isError) {
    return (
      <main className="operations-checking operations-error-state">
        <strong>Operations access could not be verified</strong>
        <span>{accessQuery.error.message}. Contact the site administrator if this continues.</span>
        <button type="button" onClick={() => void accessQuery.refetch()}>Retry</button>
      </main>
    )
  }

  return <OperationsConsole />
}
