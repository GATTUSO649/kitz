import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  BellRing,
  BriefcaseBusiness,
  CloudCog,
  Database,
  FileWarning,
  HardDrive,
  LayoutDashboard,
  Lock,
  LogOut,
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
    averageResponseMs: number | null
    p95ResponseMs: number | null
    endpoints: EndpointMetric[]
    collectedAt: string
    timeline: RequestBucket[]
  }
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
type OperationsUser = { id: number; fullName: string }
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

function OperationsLogin({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [isSigningUp, setIsSigningUp] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)

    try {
      await operationsApi(isSigningUp ? '/api/v1/operations/register' : '/api/v1/operations/login', {
        method: 'POST',
        body: JSON.stringify(
          isSigningUp
            ? {
                fullName: String(form.get('fullName')),
                email: String(form.get('email')),
                password: String(form.get('password')),
                secretKey: String(form.get('secretKey')),
              }
            : {
                email: String(form.get('email')),
                password: String(form.get('password')),
              },
        ),
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
        <h1>{isSigningUp ? 'Create IT operator account' : 'IT operations sign in'}</h1>
        <p>This account is separate from the storefront and admin session controls.</p>

        {isSigningUp && <label>Full name<input name="fullName" autoComplete="name" minLength={2} maxLength={160} required /></label>}
        <label>Operations email<input name="email" type="email" autoComplete="username" maxLength={254} required /></label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={isSigningUp ? 'new-password' : 'current-password'}
            minLength={isSigningUp ? 14 : undefined}
            maxLength={128}
            required
          />
        </label>
        {isSigningUp && <label>IT secret key<input name="secretKey" type="password" autoComplete="off" maxLength={512} required /></label>}

        {error && <p className="operations-error" role="alert">{error}</p>}

        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : isSigningUp ? 'Create IT account' : 'Sign in to operations'}</button>

        <button
          className="operations-signup-toggle"
          type="button"
          onClick={() => {
            setIsSigningUp((value) => !value)
            setError('')
          }}
        >
          {isSigningUp ? 'Already have an account? Sign in' : 'Create IT operator account'}
        </button>

        <a className="operations-admin-signup" href="/admin/register">Need a store administrator account? Create one</a>
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

  const overviewQuery = useQuery({
    queryKey: ['operations', 'overview'],
    queryFn: async () => (await operationsApi<OperationsOverview>('/api/v1/operations/overview')).data!,
    refetchInterval: 30_000,
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

    const idleTimeoutMs = 15 * 60_000
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

  if (sessionExpired || (overviewQuery.error instanceof OperationsApiError && overviewQuery.error.status === 401)) {
    return <OperationsLogin onAuthenticated={async () => { setSessionExpired(false); await queryClient.invalidateQueries({ queryKey: ['operations'] }) }} />
  }

  const overview = overviewQuery.data
  const threatPosture = { label: 'Unavailable', tone: 'threat-unknown' }
  const topEndpoints = overview?.requests.endpoints.slice(0, 5) ?? []
  const trafficPeak = Math.max(1, ...(overview?.requests.timeline.map((bucket) => bucket.requestCount) ?? []))

  const moduleContent: Record<ModuleKey, ReactNode> = {
    overview: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Live overview</span>
            <h2>Platform status</h2>
            <p>Application telemetry, request health, and protected service signals.</p>
          </div>
          <span className={`operations-threat-pill ${threatPosture.tone}`}>Security feed unavailable</span>
        </div>

        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Requests, last minute</span><strong>{overview?.requests.requestsLastMinute ?? 0}</strong><small>Application requests</small></article>
          <article className="operations-stat-card"><span>HTTP errors</span><strong>{overview?.requests.errorCount ?? 0}</strong><small>4xx + 5xx</small></article>
          <article className="operations-stat-card"><span>Avg response</span><strong>{overview?.requests.averageResponseMs === null ? '—' : `${overview?.requests.averageResponseMs} ms`}</strong><small>Service latency</small></article>
          <article className="operations-stat-card"><span>Threat level</span><strong>{threatPosture.label}</strong><small>No security-event feed configured</small></article>
        </div>

        <section className="operations-panel-grid">
          <article className="operations-panel-card operations-traffic-chart">
            <header>
              <span className="operations-eyebrow">Application traffic · last hour</span>
              <h3>Requests over time</h3>
            </header>
            {overview?.requests.timeline.length ? (
              <div className="operations-traffic-plot" role="img" aria-label="Application request counts in twelve five-minute buckets for the last hour">
                {overview.requests.timeline.map((bucket) => (
                  <div className="operations-traffic-column" key={bucket.bucketStartedAt} title={`${new Date(bucket.bucketStartedAt).toLocaleTimeString()} · ${bucket.requestCount} requests · ${bucket.errorCount} errors`}>
                    <span className="operations-traffic-count">{bucket.requestCount}</span>
                    <div className="operations-traffic-bar-track">
                      <i style={{ height: `${Math.max(bucket.requestCount ? 8 : 0, (bucket.requestCount / trafficPeak) * 100)}%` }} />
                    </div>
                    <small>{new Date(bucket.bucketStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="operations-empty-notice">Traffic history is unavailable.</p>
            )}
            <p className="operations-chart-footnote">12 five-minute buckets · sampled in this application process · collected {overview?.requests.collectedAt ? new Date(overview.requests.collectedAt).toLocaleTimeString() : '—'}</p>
          </article>

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
          <article className="operations-stat-card"><span>Sampled requests</span><strong>{overview?.requests.requestCount ?? 0}</strong><small>Rolling sample</small></article>
          <article className="operations-stat-card"><span>Failed requests</span><strong>{overview?.requests.errorCount ?? 0}</strong><small>4xx + 5xx</small></article>
          <article className="operations-stat-card"><span>P95</span><strong>{overview?.requests.p95ResponseMs === null ? '—' : `${overview?.requests.p95ResponseMs} ms`}</strong><small>Response distribution</small></article>
          <article className="operations-stat-card"><span>Security events</span><strong>{threatPosture.label}</strong><small>Request errors are not threat detections</small></article>
        </div>
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
          <article className="operations-stat-card"><span>Uptime</span><strong>{formatDuration(overview?.application.uptimeSeconds ?? 0)}</strong><small>Node {overview?.application.nodeVersion ?? 'unknown'}</small></article>
          <article className="operations-stat-card"><span>Memory RSS</span><strong>{formatBytes(overview?.application.memoryRssBytes ?? 0)}</strong><small>Heap {formatBytes(overview?.application.heapUsedBytes ?? 0)}</small></article>
          <article className="operations-stat-card"><span>Errors</span><strong>{overview?.requests.errorCount ?? 0}</strong><small>Request failures</small></article>
          <article className="operations-stat-card"><span>Trace source</span><strong>Express</strong><small>Request IDs enabled</small></article>
        </div>
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
          <article className="operations-stat-card"><span>Threat level</span><strong>{threatPosture.label}</strong><small>No security-event feed configured</small></article>
          <article className="operations-stat-card"><span>Auth checks</span><strong>Protected</strong><small>Session checks enforced</small></article>
          <article className="operations-stat-card"><span>Rate limiting</span><strong>Enabled</strong><small>API and auth throttling applied</small></article>
          <article className="operations-stat-card"><span>Audit trail</span><strong>Active</strong><small>Privileged actions are recorded</small></article>
        </div>
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
          <article className="operations-stat-card"><span>Detection rules</span><strong>Policy-based</strong><small>Rule engine remains active</small></article>
          <article className="operations-stat-card"><span>Suspicious activity</span><strong>Unavailable</strong><small>No detection rules are connected</small></article>
          <article className="operations-stat-card"><span>Escalation</span><strong>Manual</strong><small>Approval required before blocks</small></article>
          <article className="operations-stat-card"><span>Analysis</span><strong>Guarded</strong><small>Operations data is role-protected</small></article>
        </div>
      </>
    ),
    vulnerabilities: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Vulnerability management</span>
            <h2>Tracked findings and remediation</h2>
            <p>Findings are displayed only where a verified source is available.</p>
          </div>
        </div>
        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Findings</span><strong>0</strong><small>No scanner connected</small></article>
          <article className="operations-stat-card"><span>Risk posture</span><strong>Unknown</strong><small>Requires a trusted source</small></article>
          <article className="operations-stat-card"><span>Scan coverage</span><strong>None</strong><small>No authorized integration configured</small></article>
          <article className="operations-stat-card"><span>Remediation</span><strong>Manual</strong><small>Approval required</small></article>
        </div>
      </>
    ),
    'identity-access': (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Identity and access</span>
            <h2>Role governance</h2>
            <p>Access control remains explicit, least-privilege, and audited.</p>
          </div>
        </div>
        <div className="operations-stat-grid">
          <article className="operations-stat-card"><span>Role model</span><strong>Explicit</strong><small>Grant-based access only</small></article>
          <article className="operations-stat-card"><span>IT roles</span><strong>6</strong><small>Super admin, analyst, support, DB, infra, viewer</small></article>
          <article className="operations-stat-card"><span>Session model</span><strong>Protected</strong><small>Admin auth remains mandatory</small></article>
          <article className="operations-stat-card"><span>Audit status</span><strong>Active</strong><small>Changes are recorded</small></article>
        </div>
      </>
    ),
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
          <article className="operations-stat-card"><span>Connection model</span><strong>Pool-based</strong><small>Read-only health checks</small></article>
          <article className="operations-stat-card"><span>RLS finding</span><strong>Tracked</strong><small>Security audit remains documented</small></article>
        </div>
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
            <h2>Operational reports</h2>
            <p>Historical report generation is grouped by source and time range.</p>
          </div>
        </div>
        <article className="operations-panel-card full-span">
          <header><span className="operations-eyebrow">Available reports</span><h3>Current coverage</h3></header>
          <div className="operations-mini-list">
            <div className="operations-mini-item"><span>Traffic</span><strong className="status-ok">Available</strong><small>Current request sample and endpoint metrics</small></div>
            <div className="operations-mini-item"><span>Security</span><strong className="status-watch">Partially configured</strong><small>Rule-based posture only</small></div>
            <div className="operations-mini-item"><span>Payments</span><strong className="status-watch">Pending integration</strong><small>Requires provider verification</small></div>
            <div className="operations-mini-item"><span>Backups</span><strong className="status-watch">Pending source</strong><small>Restore validation not active</small></div>
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
    settings: (
      <>
        <div className="operations-masthead">
          <div>
            <span className="operations-eyebrow">Configuration</span>
            <h2>Operational settings</h2>
            <p>Safe settings are controlled by the admin backend and remain protected by explicit access rules.</p>
          </div>
        </div>
        <article className="operations-panel-card full-span">
          <header><span className="operations-eyebrow">Safe settings</span><h3>Operational controls</h3></header>
          <div className="operations-mini-list">
            <div className="operations-mini-item"><span>Alert thresholds</span><strong className="status-watch">Policy-defined</strong><small>Granular tuning is handled via backend config</small></div>
            <div className="operations-mini-item"><span>Retention windows</span><strong className="status-watch">Planned</strong><small>Future monitoring policy</small></div>
            <div className="operations-mini-item"><span>Notifications</span><strong className="status-watch">Guarded</strong><small>Targets remain centralized and approved</small></div>
            <div className="operations-mini-item"><span>Secrets</span><strong className="status-ok">Protected</strong><small>Never exposed through the operations UI</small></div>
          </div>
        </article>
      </>
    ),
  }

  return (
    <main className="operations-shell operations-shell-advanced">
      <aside className="operations-sidebar">
        <div className="operations-sidebar-brand">
          <span className="operations-brand-mark"><Activity size={18} /></span>
          <div>
            <span>KitCulture</span>
            <strong>Operations</strong>
          </div>
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
