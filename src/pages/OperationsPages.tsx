import { useEffect, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, ArrowRight, Check, CircleHelp, LogOut, RefreshCw, Shield, Siren, X } from 'lucide-react'
import '../operations-theme.css'

type OperationsPayload<T> = { data?: T; error?: { code?: string; message?: string }; pagination?: { nextCursor: number | null; hasMore: boolean } }
type EndpointMetric = { endpoint: string; requests: number; errors: number; averageResponseMs: number }
type OperationsOverview = {
  application: { status: string; uptimeSeconds: number; nodeVersion: string; memoryRssBytes: number; heapUsedBytes: number }
  databases: { name: string; status: string; latencyMs: number | null }[]
  requests: { requestCount: number; errorCount: number; serverErrorCount: number; averageResponseMs: number | null; p95ResponseMs: number | null; endpoints: EndpointMetric[] }
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

class OperationsApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function operationsApi<T>(url: string, init?: RequestInit): Promise<OperationsPayload<T>> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  const payload = await response.json().catch(() => ({})) as OperationsPayload<T>
  if (!response.ok) throw new OperationsApiError(payload.error?.message ?? 'Operations request failed.', response.status, payload.error?.code)
  return payload
}

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

function OperationsLogin({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [isSigningUp, setIsSigningUp] = useState(false)
  const signupStatusQuery = useQuery({
    queryKey: ['operations', 'registration-status'],
    queryFn: async () => (await operationsApi<{ available: boolean }>('/api/v1/operations/registration-status')).data?.available ?? false,
    retry: false,
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      await operationsApi(isSigningUp ? '/api/v1/operations/register' : '/api/v1/operations/login', {
        method: 'POST',
        body: JSON.stringify(isSigningUp ? {
          fullName: String(form.get('fullName')),
          email: String(form.get('email')),
          password: String(form.get('password')),
          secretKey: String(form.get('secretKey')),
        } : { email: String(form.get('email')), password: String(form.get('password')) }),
      })
      await onAuthenticated()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Operations sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="operations-login-page"><form className="operations-login-form" onSubmit={(event) => void submit(event)}><span className="operations-eyebrow">SEPARATE OPERATIONS IDENTITY</span><h1>{isSigningUp ? 'Create IT operator account' : 'IT Operations sign in'}</h1><p>This account is separate from KitCulture store administration.</p>{isSigningUp && <label>Full name<input name="fullName" autoComplete="name" minLength={2} maxLength={160} required /></label>}<label>Operations email<input name="email" type="email" autoComplete="username" maxLength={254} required /></label><label>Password<input name="password" type="password" autoComplete={isSigningUp ? 'new-password' : 'current-password'} minLength={isSigningUp ? 14 : undefined} maxLength={128} required /></label>{isSigningUp && <label>IT secret key<input name="secretKey" type="password" autoComplete="off" maxLength={512} required /></label>}{error && <p className="operations-error" role="alert">{error}</p>}<button type="submit" disabled={busy}>{busy ? 'Please wait…' : isSigningUp ? 'Create IT account' : 'Sign in to operations'}</button>{signupStatusQuery.data && <button className="operations-signup-toggle" type="button" onClick={() => { setIsSigningUp(!isSigningUp); setError('') }}>{isSigningUp ? 'Already have an account? Sign in' : 'Create IT operator account'}</button>}<a href="/">Return to storefront</a></form></main>
}

function OperationsConsole() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'overview' | 'incidents' | 'audit'>('overview')
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [error, setError] = useState('')
  const overviewQuery = useQuery({
    queryKey: ['operations', 'overview'],
    queryFn: async () => (await operationsApi<OperationsOverview>('/api/v1/operations/overview')).data!,
    refetchInterval: 30_000,
    retry: false,
  })
  const incidentsQuery = useInfiniteQuery({
    queryKey: ['operations', 'incidents'],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '25' })
      if (pageParam) query.set('cursor', String(pageParam))
      return operationsApi<Incident[]>(`/api/v1/operations/incidents?${query}`)
    },
    getNextPageParam: (lastPage) => lastPage.pagination?.hasMore ? lastPage.pagination.nextCursor ?? undefined : undefined,
    enabled: activeTab === 'incidents',
    retry: false,
  })
  const operatorsQuery = useQuery({
    queryKey: ['operations', 'operators'],
    queryFn: async () => (await operationsApi<OperationsUser[]>('/api/v1/operations/operators')).data ?? [],
    enabled: activeTab === 'incidents',
    retry: false,
  })
  const auditQuery = useInfiniteQuery({
    queryKey: ['operations', 'audit'],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '25' })
      if (pageParam) query.set('cursor', String(pageParam))
      return operationsApi<OperationsAudit[]>(`/api/v1/operations/audit?${query}`)
    },
    getNextPageParam: (lastPage) => lastPage.pagination?.hasMore ? lastPage.pagination.nextCursor ?? undefined : undefined,
    enabled: activeTab === 'audit',
    retry: false,
  })
  const eventsQuery = useQuery({
    queryKey: ['operations', 'incident-events', selectedIncidentId],
    queryFn: async () => (await operationsApi<IncidentEvent[]>(`/api/v1/operations/incidents/${selectedIncidentId}/events`)).data ?? [],
    enabled: activeTab === 'incidents' && selectedIncidentId !== null,
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
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    events.forEach((name) => window.addEventListener(name, recordActivity, { passive: true }))
    recordActivity()
    return () => {
      window.clearTimeout(idleTimer)
      events.forEach((name) => window.removeEventListener(name, recordActivity))
    }
  }, [sessionExpired])

  async function createIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const formElement = event.currentTarget
    const form = new FormData(formElement)
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
      formElement.reset()
      await queryClient.invalidateQueries({ queryKey: ['operations', 'incidents'] })
      await queryClient.invalidateQueries({ queryKey: ['operations', 'overview'] })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Incident could not be created.')
    }
  }

  async function updateIncident(incident: Incident, patch: Record<string, unknown>) {
    setError('')
    try {
      await operationsApi(`/api/v1/operations/incidents/${incident.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      await queryClient.invalidateQueries({ queryKey: ['operations', 'incidents'] })
      await queryClient.invalidateQueries({ queryKey: ['operations', 'incident-events', incident.id] })
      await queryClient.invalidateQueries({ queryKey: ['operations', 'overview'] })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Incident could not be updated.')
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedIncidentId === null) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const message = String(form.get('message') ?? '').trim()
    if (!message) return
    try {
      await operationsApi(`/api/v1/operations/incidents/${selectedIncidentId}/events`, { method: 'POST', body: JSON.stringify({ message }) })
      formElement.reset()
      await queryClient.invalidateQueries({ queryKey: ['operations', 'incident-events', selectedIncidentId] })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Note could not be added.')
    }
  }

  async function saveIncidentResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedIncidentId === null) return
    const incident = incidents.find((item) => item.id === selectedIncidentId)
    if (!incident) return
    const form = new FormData(event.currentTarget)
    await updateIncident(incident, {
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

  if (sessionExpired || (overviewQuery.error instanceof OperationsApiError && overviewQuery.error.status === 401)) return <OperationsLogin onAuthenticated={async () => { setSessionExpired(false); await queryClient.invalidateQueries({ queryKey: ['operations'] }) }} />
  const overview = overviewQuery.data
  const incidents = incidentsQuery.data?.pages.flatMap((page) => page.data ?? []) ?? []
  const audits = auditQuery.data?.pages.flatMap((page) => page.data ?? []) ?? []
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId)

  return <main className="operations-shell">
    <header className="operations-header"><div className="operations-brand"><span className="operations-brand-mark"><Activity size={18} /></span><div><span>KitCulture / Restricted</span><strong>IT Operations</strong></div></div><div className="operations-header-actions"><span className="operations-access-label"><Shield size={14} /> Operations identity</span><button type="button" className="operations-signout" onClick={() => void signOut()}><LogOut size={14} /> Sign out</button></div></header>
    <section className="operations-content">
      <div className="operations-title-row"><div><span className="operations-eyebrow">OPERATIONS CONSOLE</span><h1>Service health & response</h1><p>Live application signals and operator-managed incidents.</p></div><button className="operations-refresh" type="button" onClick={() => void overviewQuery.refetch()} disabled={overviewQuery.isFetching}><RefreshCw size={15} /> Refresh</button></div>
      <nav className="operations-tabs" aria-label="Operations views">
        {(['overview', 'incidents', 'audit'] as const).map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'is-active' : ''} aria-current={activeTab === tab ? 'page' : undefined} onClick={() => setActiveTab(tab)}>{label(tab)}</button>)}
      </nav>
      {error && <p className="operations-error" role="alert"><AlertTriangle size={15} />{error}</p>}
      {overviewQuery.isPending ? <div className="operations-empty" role="status">Loading live service signals…</div>
        : overviewQuery.isError ? <div className="operations-empty operations-error-state"><strong>Operations data unavailable</strong><span>{overviewQuery.error.message}. Confirm the operations migration is applied and operator access is granted.</span></div>
          : activeTab === 'overview' ? <>
            <div className="operations-status-grid">
              <article className="operations-status-card"><span>Application</span><strong className="is-healthy"><Check size={16} /> {overview?.application.status}</strong><small>Uptime {formatDuration(overview?.application.uptimeSeconds ?? 0)} · Node {overview?.application.nodeVersion}</small></article>
              {overview?.databases.map((database) => <article className="operations-status-card" key={database.name}><span>{label(database.name)} database</span><strong className={database.status === 'healthy' ? 'is-healthy' : 'is-unavailable'}>{database.status === 'healthy' ? <Check size={16} /> : <X size={16} />}{label(database.status)}</strong><small>{database.latencyMs === null ? 'Latency unavailable' : `${database.latencyMs} ms probe`}</small></article>)}
              <article className="operations-status-card"><span>Active incidents</span><strong><Siren size={16} /> {(overview?.incidents.open ?? 0) + (overview?.incidents.investigating ?? 0)}</strong><small>{overview?.incidents.open ?? 0} open · {overview?.incidents.investigating ?? 0} investigating</small></article>
              <article className="operations-status-card"><span>Process memory</span><strong><Activity size={16} /> {formatBytes(overview?.application.memoryRssBytes ?? 0)}</strong><small>Heap {formatBytes(overview?.application.heapUsedBytes ?? 0)}</small></article>
            </div>
            <section className="operations-panel"><header><div><span className="operations-eyebrow">LAST 60 MINUTES</span><h2>Request performance</h2></div></header><div className="operations-metric-strip"><div><span>Requests sampled</span><strong>{overview?.requests.requestCount ?? 0}</strong></div><div><span>HTTP errors</span><strong>{overview?.requests.errorCount ?? 0}</strong></div><div><span>Server errors</span><strong>{overview?.requests.serverErrorCount ?? 0}</strong></div><div><span>Average response</span><strong>{overview?.requests.averageResponseMs === null ? '—' : `${overview?.requests.averageResponseMs} ms`}</strong></div><div><span>P95 response</span><strong>{overview?.requests.p95ResponseMs === null ? '—' : `${overview?.requests.p95ResponseMs} ms`}</strong></div></div>
              <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Endpoint</th><th>Requests</th><th>Errors</th><th>Avg response</th></tr></thead><tbody>{overview?.requests.endpoints.map((metric) => <tr key={metric.endpoint}><td>{metric.endpoint}</td><td>{metric.requests}</td><td>{metric.errors}</td><td>{metric.averageResponseMs} ms</td></tr>)}{!overview?.requests.endpoints.length && <tr><td colSpan={4}>No requests sampled yet.</td></tr>}</tbody></table></div><p className="operations-footnote">Per-process rolling sample, up to 5,000 requests. Data resets on restart and is not shared across instances.</p>
            </section>
            <section className="operations-panel"><header><div><span className="operations-eyebrow">PROVIDER INTEGRATIONS</span><h2>External service status</h2></div></header><div className="operations-provider-grid">{Object.entries(overview?.externalServices ?? {}).map(([service, status]) => <article key={service}><span>{label(service)}</span><strong><CircleHelp size={15} /> Unknown</strong><small>{status.reason}</small></article>)}</div></section>
            <section className="operations-panel"><header><div><span className="operations-eyebrow">CUSTOMER CARE</span><h2>Support integration</h2></div></header><p>Customer conversations remain in the existing support system. Operations-specific support triage is not configured yet.</p></section>
          </> : activeTab === 'incidents' ? <div className="operations-incident-layout">
            <section className="operations-panel"><header><div><span className="operations-eyebrow">INCIDENT REGISTER</span><h2>Open and recent incidents</h2></div><Siren size={18} /></header>
              {incidentsQuery.isPending ? <div className="operations-empty">Loading incidents…</div> : incidentsQuery.isError ? <div className="operations-empty operations-error-state">{incidentsQuery.error.message}</div> : incidents.map((incident) => <button className={`operations-incident-row${selectedIncidentId === incident.id ? ' is-selected' : ''}`} key={incident.id} type="button" onClick={() => setSelectedIncidentId(incident.id)}><span className={`operations-severity severity-${incident.severity.toLowerCase()}`}>{incident.severity}</span><span className="operations-incident-copy"><strong>{incident.title}</strong><small>{incident.incidentNumber} · {label(incident.status)} · {label(incident.affectedComponent)}</small></span><ArrowRight size={15} /></button>)}
              {incidentsQuery.hasNextPage && <button className="operations-secondary-button" type="button" onClick={() => void incidentsQuery.fetchNextPage()} disabled={incidentsQuery.isFetchingNextPage}>{incidentsQuery.isFetchingNextPage ? 'Loading…' : 'Load more incidents'}</button>}
              <form className="operations-create-form" onSubmit={(event) => void createIncident(event)}><h3>Open an incident</h3><div className="operations-form-row"><label>Severity<select name="severity" defaultValue="P3"><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select></label><label>Component<select name="affectedComponent" defaultValue="api"><option value="website">Website</option><option value="api">API</option><option value="database">Database</option><option value="payments">Payments</option><option value="email">Email</option><option value="security">Security</option><option value="other">Other</option></select></label></div><label>Title<input name="title" required minLength={4} maxLength={160} /></label><label>Description<textarea name="description" required minLength={10} maxLength={4000} rows={3} /></label><button type="submit">Create incident</button></form>
            </section>
            <section className="operations-panel operations-incident-detail"><header><div><span className="operations-eyebrow">INCIDENT DETAIL</span><h2>{selectedIncident?.incidentNumber ?? 'Select an incident'}</h2></div></header>{selectedIncident ? <><h3>{selectedIncident.title}</h3><p>{selectedIncident.description}</p><div className="operations-incident-controls"><label>Status<select value={selectedIncident.status} onChange={(event) => void updateIncident(selectedIncident, { status: event.target.value })}><option value="open">Open</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label><label>Severity<select value={selectedIncident.severity} onChange={(event) => void updateIncident(selectedIncident, { severity: event.target.value })}><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select></label><label>Assignee<select value={selectedIncident.assignedOperationsUserId ?? ''} disabled={operatorsQuery.isPending || operatorsQuery.isError} onChange={(event) => void updateIncident(selectedIncident, { assignedOperationsUserId: event.target.value ? Number(event.target.value) : null })}><option value="">Unassigned</option>{operatorsQuery.data?.map((operator) => <option key={operator.id} value={operator.id}>{operator.fullName}</option>)}</select></label></div><form className="operations-note-form" onSubmit={(event) => void saveIncidentResolution(event)}><label>Root cause<textarea key={`cause-${selectedIncident.id}`} name="rootCause" defaultValue={selectedIncident.rootCause ?? ''} maxLength={4000} rows={2} /></label><label>Resolution notes<textarea key={`resolution-${selectedIncident.id}`} name="resolutionNotes" defaultValue={selectedIncident.resolutionNotes ?? ''} maxLength={4000} rows={2} /></label><button type="submit">Save resolution details</button></form><div className="operations-timeline">{eventsQuery.isPending ? <p>Loading incident history…</p> : eventsQuery.data?.map((item) => <article key={item.id}><span>{label(item.eventType)} · {item.actorName}</span><p>{item.message}</p><time>{new Date(item.createdAt).toLocaleString()}</time></article>)}</div><form className="operations-note-form" onSubmit={(event) => void addNote(event)}><label>Add investigation note<textarea name="message" required maxLength={4000} rows={2} /></label><button type="submit">Add note</button></form></> : <div className="operations-empty">Choose an incident to inspect its history and update its status.</div>}</section>
          </div> : <section className="operations-panel"><header><div><span className="operations-eyebrow">APPEND-ONLY RECORD</span><h2>Operations audit history</h2></div></header>{auditQuery.isPending ? <div className="operations-empty">Loading audit events…</div> : auditQuery.isError ? <div className="operations-empty operations-error-state">{auditQuery.error.message}</div> : <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>{audits.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.actorName ?? label(entry.actorType)}</td><td>{label(entry.action)}</td><td>{entry.targetType} · {entry.targetId}</td><td>{entry.details ?? '—'}</td></tr>)}{!audits.length && <tr><td colSpan={5}>No operations audit events yet.</td></tr>}</tbody></table></div>}{auditQuery.hasNextPage && <button className="operations-secondary-button" type="button" onClick={() => void auditQuery.fetchNextPage()} disabled={auditQuery.isFetchingNextPage}>{auditQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}</section>}
    </section>
  </main>
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
    return <main className="operations-checking operations-error-state"><strong>Operations access could not be verified</strong><span>{accessQuery.error.message}. Confirm the operations schema migration and try again.</span><button type="button" onClick={() => void accessQuery.refetch()}>Retry</button></main>
  }
  return <OperationsConsole />
}