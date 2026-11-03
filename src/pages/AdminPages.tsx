import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { userFacingErrorMessage } from '../components/notification-api'
import { AdminApiError, formatAdminOrderNumber, isAdminSessionExpired } from './admin-tools'
import { Activity, AlertTriangle, ArrowRight, ArrowUpDown, BarChart3, Bell, Check, CircleHelp, Copy, Database, Filter, Image as ImageIcon, LayoutDashboard, LogOut, MapPin, Menu, MessageCircle, Package, Search, Send, Shield, Star, Trash2, Trophy, Upload, Users, X } from 'lucide-react'
import { GoogleMapView } from '../components/GoogleMapView'
import { matchesNationalTeam, NATIONAL_TEAM_NAMES } from '../nationalTeams'

type AdminRecord = Record<string, unknown>
type AdminPayload<T> = { data?: T; error?: { code?: string; message?: string }; pagination?: { limit: number; nextCursor: number | null; hasMore: boolean } }
const adminSessionExpiredEvent = 'kitculture:admin-session-expired'
type CatalogueLeague = { id: number; name: string; slug: string; country: string; countryCode: string; season: string; sortOrder: number; active: boolean }
type CatalogueTeam = { id: number; leagueId: number; name: string; slug: string; sortOrder: number; active: boolean }
type CatalogueJerseyCategory = { id: number; name: string; slug: string; sortOrder: number; active: boolean }
type CatalogueOptions = { leagues: CatalogueLeague[]; teams: CatalogueTeam[]; jerseyCategories: CatalogueJerseyCategory[] }
type ItAccessRole = 'super_admin' | 'security_analyst' | 'it_support' | 'database_admin' | 'infrastructure_admin' | 'viewer'
type ItRequestBucket = { bucketStartedAt: string; requestCount: number; errorCount: number; serverErrorCount: number; securitySignalCount: number; averageResponseMs: number | null; p95ResponseMs: number | null }
type ItChartPoint = { label: string; value: number; detail: string }
type ItOverviewData = {
  access: { role: ItAccessRole; permissions: string[] }
  application: { status: string; uptimeSeconds: number; nodeVersion: string; memoryRssBytes: number; heapUsedBytes: number }
  databases: { name: string; status: 'healthy' | 'unavailable'; latencyMs: number | null }[]
  requests: { requestCount: number; requestsLastMinute: number; errorCount: number; clientErrorCount: number; serverErrorCount: number; successfulRequestCount: number; securitySignalCount: number; securitySignalsLastMinute: number; averageResponseMs: number | null; p95ResponseMs: number | null; collectedAt: string; endpoints: { endpoint: string; requests: number; errors: number; averageResponseMs: number }[]; timeline: ItRequestBucket[]; methods: { method: string; requests: number }[]; responseDistribution: { success: number; redirect: number; clientError: number; serverError: number } }
  incidents: { status: 'available' | 'unavailable'; total: number | null; open: number | null; investigating: number | null }
  coverage: Record<string, { status: string }>
  externalServices: Record<string, { status: string; reason?: string }>
}
type ItAccessGrant = { adminUserId: number; email: string; fullName: string; role: ItAccessRole; grantedAt: string }
type ItIncident = { id: number; incidentNumber: string; severity: 'P1' | 'P2' | 'P3' | 'P4'; status: 'open' | 'investigating' | 'resolved' | 'closed'; title: string; description: string; affectedComponent: string; assignedAdminUserId: number | null; assignedOperationsUserId: number | null; assigneeName: string | null; rootCause: string | null; resolutionNotes: string | null; detectedAt: string; resolvedAt: string | null; createdAt: string; updatedAt: string }
type ItIncidentEvent = { id: number; eventType: string; message: string; createdAt: string; actorName: string | null }
type ItAuditEntry = { id: number; actorType: string; actorName: string | null; action: string; targetType: string; targetId: string; details: string | null; createdAt: string }
const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const productSlug = (...parts: string[]) => {
  const value = slugify(parts.filter(Boolean).join('-'))
  if (value.length <= 200) return value
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const suffix = (hash >>> 0).toString(36)
  return `${value.slice(0, 199 - suffix.length).replace(/-+$/g, '')}-${suffix}`
}
const variantSku = (productIdentity: string, size: string) => {
  let hash = 2166136261
  for (const character of productIdentity.toLowerCase()) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const suffix = `${(hash >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(-7)}-${size}`
  const base = slugify(productIdentity).toUpperCase() || 'KIT'
  return `${base.slice(0, 79 - suffix.length)}-${suffix}`
}
const productSizes = ['YXS', 'YS', 'YM', 'YL', 'YXL', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']

function availableProductSeasons(leagues: CatalogueLeague[]) {
  const now = new Date()
  const currentStartYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
  const currentSeasons = Array.from({ length: 5 }, (_, index) => {
    const start = currentStartYear - index
    return `${start}/${String(start + 1).slice(-2)}`
  })
  return [...new Set([...currentSeasons, ...leagues.map((league) => league.season)])].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
}

const sections = [
  ['dashboard', 'Overview', '/admin', LayoutDashboard],
  ['it', 'IT operations', '/admin/it', Shield],
  ['products', 'Products', '/admin/products', Package],
  ['football', 'Leagues & teams', '/admin/football', Trophy],
  ['homepage', 'Homepage', '/admin/homepage', ImageIcon],
  ['categories', 'Kit collections', '/admin/categories', Package],
  ['orders', 'Orders', '/admin/orders', Package],
  ['guest-orders', 'Guest management', '/admin/guest-orders', Users],
  ['notifications', 'Notifications', '/admin/notifications', Bell],
  ['customers', 'Customers', '/admin/customers', Users],
  ['support', 'Customer chats', '/admin/support', MessageCircle],
  ['inventory', 'Inventory', '/admin/inventory', Package],
  ['delivery', 'Delivery zones', '/admin/delivery', Package],
  ['payments', 'Payments', '/admin/payments', Package],
  ['reports', 'Financial reports', '/admin/reports', Package],
  ['expenses', 'Expenses', '/admin/expenses', Package],
  ['settings', 'Business settings', '/admin/settings', Package],
  ['audit', 'Audit log', '/admin/audit', Package],
] as const

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    })
  } catch (error) {
    throw new Error(userFacingErrorMessage(error, 'The administrator service is unavailable. Please try again shortly.'))
  }
  if (response.status === 401 && !/\/admin\/(?:login|register|verify)(?:[/?]|$)/.test(url)) {
    window.dispatchEvent(new Event(adminSessionExpiredEvent))
  }
  if (response.status === 204) return undefined as T
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new AdminApiError(response.ok ? 'The administrator service returned an unexpected response.' : 'The administrator service is unavailable. Please try again shortly.', response.status)
  }
  const payload = await response.json() as AdminPayload<T>
  if (!response.ok) throw new AdminApiError('error' in payload ? payload.error?.message ?? 'Request failed.' : 'Request failed.', response.status, payload.error?.code)
  if (!('data' in payload) || payload.data === undefined) throw new Error('The administrator service returned an invalid response.')
  return payload.data
}

async function apiPage<T>(url: string): Promise<{ data: T; pagination?: AdminPayload<T>['pagination'] }> {
  let response: Response
  try {
    response = await fetch(url, { credentials: 'include' })
  } catch (error) {
    throw new Error(userFacingErrorMessage(error, 'The administrator service is unavailable. Please try again shortly.'))
  }
  if (response.status === 401) window.dispatchEvent(new Event(adminSessionExpiredEvent))
  const payload = await response.json().catch(() => ({})) as AdminPayload<T>
  if (!response.ok) throw new AdminApiError(payload.error?.message ?? 'Request failed.', response.status, payload.error?.code)
  if (payload.data === undefined) throw new Error('The administrator service returned an invalid response.')
  return { data: payload.data, pagination: payload.pagination }
}

const adminVerificationRequests = new Map<string, Promise<unknown>>()

function verifyAdminToken(token: string): Promise<unknown> {
  const existingRequest = adminVerificationRequests.get(token)
  if (existingRequest) return existingRequest

  const request = api('/api/v1/admin/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
  adminVerificationRequests.set(token, request)
  const removeRequest = () => {
    if (adminVerificationRequests.get(token) === request) adminVerificationRequests.delete(token)
  }
  void request.then(removeRequest, removeRequest)
  return request
}

function pretty(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (value instanceof Date) return value.toLocaleString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function OrderPaymentTables({ orders }: { orders: AdminRecord[] }) {
  const paymentStatus = (order: AdminRecord) => String(order.paymentStatus ?? '')
  const pending = orders.filter((order) => ['initiated', 'pending', 'requires_review'].includes(paymentStatus(order))
    || (order.status === 'pending_payment' && !['failed', 'cancelled', 'expired', 'refunded'].includes(paymentStatus(order))))
  const paid = orders.filter((order) => paymentStatus(order) === 'succeeded' || order.status === 'paid')
  const other = orders.filter((order) => !pending.includes(order) && !paid.includes(order))
  const displayRows = (rows: AdminRecord[]) => rows.map((order) => ({
    orderNumber: formatAdminOrderNumber(order),
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    total: order.total,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus ?? 'not_started',
    status: order.status,
    createdAt: order.createdAt,
  }))

  return <div className="admin-order-payment-tables">
    <section><header className="admin-order-payment-heading"><div><span className="admin-kicker">AWAITING VERIFICATION</span><h2>Pending payments · {pending.length}</h2></div></header><DataTable rows={displayRows(pending)} empty="No orders are awaiting payment." /></section>
    <section><header className="admin-order-payment-heading"><div><span className="admin-kicker">VERIFIED</span><h2>Paid orders · {paid.length}</h2></div></header><DataTable rows={displayRows(paid)} empty="No payments have been verified yet." /></section>
    {other.length > 0 && <section><header className="admin-order-payment-heading"><div><span className="admin-kicker">OTHER STATUSES</span><h2>Other orders · {other.length}</h2></div></header><DataTable rows={displayRows(other)} empty="No other orders." /></section>}
  </div>
}

function DataTable({ rows, empty }: { rows: AdminRecord[]; empty: string }) {
  const columns = useMemo(() => [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 8), [rows])
  const [search, setSearch] = useState('')
  const [filterColumn, setFilterColumn] = useState('')
  const [filterValue, setFilterValue] = useState('')
  const [sortColumn, setSortColumn] = useState('')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const pageSize = 10
  const filterValues = useMemo(() => filterColumn ? [...new Set(rows.map((row) => pretty(row[filterColumn])).filter((value) => value !== '—'))].sort((a, b) => a.localeCompare(b)) : [], [rows, filterColumn])
  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = rows.filter((row) => {
      const matchesSearch = !term || columns.some((column) => pretty(row[column]).toLowerCase().includes(term))
      return matchesSearch && (!filterColumn || !filterValue || pretty(row[filterColumn]) === filterValue)
    })
    if (sortColumn) filtered.sort((a, b) => {
      const left = pretty(a[sortColumn])
      const right = pretty(b[sortColumn])
      const leftNumber = Number(left)
      const rightNumber = Number(right)
      const comparison = Number.isFinite(leftNumber) && Number.isFinite(rightNumber) ? leftNumber - rightNumber : left.localeCompare(right)
      return sortDirection === 'asc' ? comparison : -comparison
    })
    return filtered
  }, [rows, columns, search, filterColumn, filterValue, sortColumn, sortDirection])
  const pageCount = Math.ceil(visibleRows.length / pageSize)
  const currentPage = Math.min(page, Math.max(0, pageCount - 1))
  const pageRows = visibleRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  if (!rows.length) return <div className="admin-empty">{empty}</div>
  return <section className="admin-data-panel">
    <div className="admin-data-toolbar">
      <label className="admin-data-search"><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} placeholder="Search records…" aria-label="Search records" /></label>
      {columns.some((column) => ['status', 'category', 'type', 'active', 'isActive', 'role'].includes(column)) && <label className="admin-data-select"><Filter size={15} /><select aria-label="Filter records by field" value={filterColumn} onChange={(event) => { setFilterColumn(event.target.value); setFilterValue(''); setPage(0) }}><option value="">No filter</option>{columns.filter((column) => ['status', 'category', 'type', 'active', 'isActive', 'role'].includes(column)).map((column) => <option key={column} value={column}>{column.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</option>)}</select></label>}
      {filterColumn && <label className="admin-data-select"><select aria-label={`Filter by ${filterColumn}`} value={filterValue} onChange={(event) => { setFilterValue(event.target.value); setPage(0) }}><option value="">All values</option>{filterValues.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
      <label className="admin-data-select"><ArrowUpDown size={15} /><select aria-label="Sort records by" value={sortColumn} onChange={(event) => { setSortColumn(event.target.value); setPage(0) }}><option value="">Default order</option>{columns.map((column) => <option key={column} value={column}>Sort by {column.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</option>)}</select></label>
      {sortColumn && <button className="admin-sort-direction" type="button" onClick={() => { setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc'); setPage(0) }}>{sortDirection === 'asc' ? 'Ascending' : 'Descending'}</button>}
      <span className="admin-data-count">{visibleRows.length} {visibleRows.length === 1 ? 'record' : 'records'}</span>
    </div>
    {pageRows.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</th>)}</tr></thead><tbody>{pageRows.map((row, index) => <tr key={String(row.id ?? row.orderNumber ?? page * pageSize + index)}>{columns.map((column) => <td key={column}>{pretty(row[column])}</td>)}</tr>)}</tbody></table></div> : <div className="admin-empty">No records match the current search and filters.</div>}
    {pageCount > 1 && <div className="admin-pagination"><span>Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, visibleRows.length)} of {visibleRows.length}</span><div><button type="button" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>Next</button></div></div>}
  </section>
}

function AdminDashboardCharts({ data }: { data: AdminRecord }) {
  const revenueTrend = Array.isArray(data.revenueTrend) ? data.revenueTrend as { date: string; revenue: string }[] : []
  const salesByCategory = Array.isArray(data.salesByCategory) ? data.salesByCategory as { category: string; units: string }[] : []
  const salesByLocation = Array.isArray(data.salesByLocation) ? data.salesByLocation as { location: string; orders: number }[] : []
  const bestSellers = Array.isArray(data.bestSellers) ? data.bestSellers as { name: string; units: string }[] : []
  const worstSellers = Array.isArray(data.worstSellers) ? data.worstSellers as { name: string; units: string }[] : []
  const chartEntries = (entries: { label: string; value: string | number }[], formatter: (value: number) => string) => {
    const maximum = Math.max(1, ...entries.map(({ value }) => Number(value) || 0))
    return entries.length ? <div className="admin-bar-chart">{entries.map((entry) => {
      const value = Number(entry.value) || 0
      return <div className="admin-bar-row" key={entry.label}><span title={entry.label}>{entry.label}</span><div><i style={{ width: `${Math.max(value ? 3 : 0, value / maximum * 100)}%` }} /></div><strong>{formatter(value)}</strong></div>
    })}</div> : <div className="admin-chart-empty">No sales recorded in this period.</div>
  }
  const quantity = (value: number) => value.toLocaleString('en-KE')
  return <section className="admin-analytics">
    <div className="admin-analytics-heading"><div><span className="admin-kicker">BUSINESS INTELLIGENCE</span><h2>Performance at a glance</h2><p>{String(data.from)} to {String(data.to)}</p></div><BarChart3 size={20} /></div>
    <div className="admin-chart-grid">
      <article className="admin-chart-card"><div><h3>Paid revenue by day</h3><p>Successful payment records · KES</p></div>{chartEntries(revenueTrend.map(({ date, revenue }) => ({ label: date, value: revenue })), (value) => value.toLocaleString('en-KE'))}</article>
      <article className="admin-chart-card"><div><h3>Sales by category</h3><p>Units in paid and fulfilled orders</p></div>{chartEntries(salesByCategory.map(({ category, units }) => ({ label: category, value: units })), quantity)}</article>
      <article className="admin-chart-card"><div><h3>Sales by location</h3><p>Paid and fulfilled orders by county</p></div>{chartEntries(salesByLocation.map(({ location, orders }) => ({ label: location, value: orders })), quantity)}</article>
      <article className="admin-chart-card"><div><h3>Top-selling products</h3><p>Units in paid and fulfilled orders</p></div>{chartEntries(bestSellers.map(({ name, units }) => ({ label: name, value: units })), quantity)}</article>
      <article className="admin-chart-card"><div><h3>Lowest sales</h3><p>Published products, including zero sales</p></div>{chartEntries(worstSellers.map(({ name, units }) => ({ label: name, value: units })), quantity)}</article>
    </div>
  </section>
}

const adminAuthTransitionDurationMs = 620

function transitionAdminAuth(event: MouseEvent<HTMLAnchorElement>, navigate: NavigateFunction, destination: string) {
  event.preventDefault()
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    navigate(destination)
    return
  }
  const root = document.documentElement
  if (root.dataset.adminAuthTransition) return
  root.dataset.adminAuthTransition = 'cover'
  window.setTimeout(() => {
    navigate(destination)
    window.requestAnimationFrame(() => {
      root.dataset.adminAuthTransition = 'reveal'
      window.setTimeout(() => delete root.dataset.adminAuthTransition, adminAuthTransitionDurationMs)
    })
  }, adminAuthTransitionDurationMs)
}

function AdminAuthLayout({ children }: { children: ReactNode }) {
  return <main className="admin-login-page"><section className="admin-auth-content"><div className="admin-auth-split">
    <aside className="admin-auth-side">
      <Link to="/" className="admin-auth-brand"><img src="/culture-mark.webp" alt="" /><span>KitCulture</span></Link>
      <div className="admin-auth-side-copy"><span>RESTRICTED ADMIN ACCESS</span><h2>Matchday starts<br /><em>behind the scenes.</em></h2><p>Keep the catalogue, orders, and supporter experience in sync.</p></div>
      <span className="admin-auth-side-footer">KITCULTURE OPERATIONS</span>
    </aside>
    <div className="admin-auth-fields">{children}</div>
  </div><span className="auth-legal">© 2026 KitCulture · Restricted administrator access.</span></section></main>
}

export function AdminLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      const result = await api<{ portal: string }>('/api/v1/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          identity: String(form.get('identity')),
          password: String(form.get('password')),
        }),
      })
      const returnTo = new URLSearchParams(location.search).get('returnTo')
      navigate(returnTo === '/operations' ? '/operations' : result.portal ?? '/admin', { replace: true })
    } catch (issue) {
      setError(issue instanceof TypeError ? 'We couldn\'t connect to the server. Please check your connection and try again.' : issue instanceof Error ? issue.message : 'Administrator sign in failed.')
    } finally {
      setBusy(false)
    }
  }
  return <AdminAuthLayout><form className="admin-login-card" onSubmit={(event) => void submit(event)}>
    <Link to="/" className="admin-back">← KitCulture storefront</Link><span className="admin-kicker">RESTRICTED ADMIN ACCESS</span><h1>Administrator sign in</h1>
    <p>Sign in with your email address or assigned role number and password.</p>
    {new URLSearchParams(location.search).get('verified') === '1' && <p className="admin-success" role="status">Administrator email verified. You can sign in now.</p>}
    {['expired', 'idle'].includes(new URLSearchParams(location.search).get('reason') ?? '') && <p className="admin-success" role="status">Your session has expired. Please sign in again to continue.</p>}
    <label>Email or role number<input name="identity" type="text" autoComplete="username" required maxLength={254} /></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <button className="button button-green" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} /></button>
    <p className="auth-switch">Need an administrator account? <Link to="/admin/register" onClick={(event) => transitionAdminAuth(event, navigate, '/admin/register')}>Create one</Link></p>
  </form></AdminAuthLayout>
}

export function AdminRegisterPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [verificationUrl, setVerificationUrl] = useState('')
  const setupQuery = useQuery({
    queryKey: ['admin-registration-status'],
    queryFn: () => api<{ available: boolean }>('/api/v1/admin/registration-status'),
    retry: false,
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    if (password !== String(form.get('passwordConfirmation') ?? '')) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const result = await api<{ verificationUrl: string }>('/api/v1/admin/register', {
        method: 'POST',
        body: JSON.stringify({
          email: String(form.get('email')),
          fullName: String(form.get('fullName')),
          password,
          secretKey: String(form.get('secretKey')),
        }),
      })
      setVerificationUrl(result.verificationUrl)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Administrator account creation failed.')
    } finally {
      setBusy(false)
    }
  }

  return <AdminAuthLayout><section className="admin-login-card">
    <Link to="/admin/login" className="admin-back" onClick={(event) => transitionAdminAuth(event, navigate, '/admin/login')}>← Administrator sign in</Link><span className="admin-kicker">RESTRICTED ADMIN SETUP</span><h1>Create administrator account</h1>
    {verificationUrl
      ? <><p>Account created. Use the one-time verification link below to activate the administrator account. It expires in 30 minutes.</p><Link className="button button-green" to={verificationUrl}>Verify administrator email <ArrowRight size={16} /></Link></>
      : setupQuery.isPending
        ? <p>Checking administrator setup…</p>
        : !setupQuery.isError && !setupQuery.data?.available
            ? <><p>Administrator signup is unavailable. The site owner must configure the signup key before accounts can be created.</p><Link className="button button-green" to="/admin/login" onClick={(event) => transitionAdminAuth(event, navigate, '/admin/login')}>Go to administrator sign in <ArrowRight size={16} /></Link></>
            : <>{setupQuery.isError && <p className="admin-error" role="alert">{setupQuery.error.message}</p>}<form onSubmit={(event) => void submit(event)}>
              <p>Enter the setup key configured by the site owner. Every administrator account must be verified before sign-in.</p>
              <label>Full name<input name="fullName" autoComplete="name" required minLength={2} maxLength={160} /></label>
              <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
              <label>Password<input name="password" type="password" autoComplete="new-password" required minLength={14} maxLength={128} /></label>
              <label>Confirm password<input name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={14} maxLength={128} /></label>
              <label>Administrator setup key<input name="secretKey" type="password" autoComplete="off" required maxLength={512} /></label>
              {error && <p className="admin-error" role="alert">{error}</p>}
              <button className="button button-green" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create administrator account'} <ArrowRight size={16} /></button>
            </form></>}
  </section></AdminAuthLayout>
}

export function AdminOnboardingPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const token = new URLSearchParams(location.search).get('token') ?? ''
  const roleFromUrl = new URLSearchParams(location.search).get('role') ?? ''

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    if (password !== String(form.get('passwordConfirmation') ?? '')) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await api('/api/v1/admin/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          token,
          email: String(form.get('email')),
          roleNumber: String(form.get('roleNumber')),
          password,
          confirmPassword: String(form.get('passwordConfirmation')),
        }),
      })
      setSent(true)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Administrator onboarding could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  return <AdminAuthLayout><section className="admin-login-card">
    <Link to="/admin/login" className="admin-back">← Administrator sign in</Link><span className="admin-kicker">SECURE ACTIVATION</span><h1>Complete administrator onboarding</h1>
    {sent ? <><p>Check the invited email address to verify and activate this account.</p><button className="button button-green" type="button" onClick={() => navigate('/admin/login')}>Continue to sign in</button></>
      : !token ? <p className="admin-error" role="alert">The onboarding link is missing its invitation token.</p>
        : <form onSubmit={(event) => void submit(event)}><p>Use the email address and role number included in your invitation.</p><label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} /></label><label>Assigned role number<input name="roleNumber" defaultValue={roleFromUrl} required pattern="[A-Z]+-[0-9]+" maxLength={40} /></label><label>Password<input name="password" type="password" autoComplete="new-password" required minLength={14} maxLength={128} /></label><label>Confirm password<input name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={14} maxLength={128} /></label>{error && <p className="admin-error" role="alert">{error}</p>}<button className="button button-green" type="submit" disabled={busy}>{busy ? 'Preparing activation…' : 'Continue to email verification'} <ArrowRight size={16} /></button></form>}
  </section></AdminAuthLayout>
}

export function AdminVerifyPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const token = new URLSearchParams(location.search).get('token')
  const invitation = new URLSearchParams(location.search).get('invitation') === '1'

  useEffect(() => {
    if (!token) return
    let active = true
    const request = invitation
      ? api('/api/v1/admin/verify-invitation', { method: 'POST', body: JSON.stringify({ token }) })
      : verifyAdminToken(token)
    void request.then(() => {
      if (active) navigate('/admin/login?verified=1', { replace: true })
    }).catch((issue: unknown) => {
      if (active) setError(issue instanceof Error ? issue.message : 'Administrator verification failed.')
    })
    return () => { active = false }
  }, [token, invitation, navigate])

  return <AdminAuthLayout><section className="admin-login-card">
    <Link to="/admin/login" className="admin-back">← Administrator sign in</Link><span className="admin-kicker">EMAIL VERIFICATION</span><h1>{error || !token ? 'Administrator verification could not be completed.' : 'Verifying administrator account…'}</h1>
    {!token ? <p className="admin-error" role="alert">The verification link is missing its token.</p> : error ? <p className="admin-error" role="alert">{error}</p> : <p>Please wait while we verify this one-time link. You’ll be redirected to sign in when it succeeds.</p>}
  </section></AdminAuthLayout>
}

function SectionForm({ section, onDone }: { section: string; onDone: (createdProductId?: number) => Promise<void> }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedLeagueId, setSelectedLeagueId] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [selectedJerseyCategoryId, setSelectedJerseyCategoryId] = useState('')
  const [selectedStoreCategoryId, setSelectedStoreCategoryId] = useState('')
  const [selectedSizes, setSelectedSizes] = useState<string[]>([])
  const [productName, setProductName] = useState('')
  const [productDescription, setProductDescription] = useState('')
  const [productSeason, setProductSeason] = useState('')
  const [productImage, setProductImage] = useState<File | null>(null)
  const [productImageAlt, setProductImageAlt] = useState('')
  const categoriesQuery = useQuery({
    queryKey: ['admin', 'categories'],
    enabled: section === 'products',
    queryFn: () => api<AdminRecord[]>('/api/v1/admin/categories'),
  })
  const productsQuery = useQuery({
    queryKey: ['admin', 'products'],
    enabled: section === 'products',
    queryFn: () => api<AdminRecord[]>('/api/v1/admin/products'),
  })
  const settingsQuery = useQuery({
    queryKey: ['admin', 'settings'],
    enabled: section === 'settings',
    queryFn: () => api<Record<string, string>>('/api/v1/admin/settings'),
  })
  const catalogueOptionsQuery = useQuery({
    queryKey: ['admin', 'catalogue-options'],
    enabled: section === 'products',
    queryFn: () => api<CatalogueOptions>('/api/v1/admin/catalogue-options'),
  })
  const productSuggestions = useMemo(() => {
    const context = `${productName} ${productDescription}`.toLowerCase()
    if (context.trim().length < 3) return null
    const teams = catalogueOptionsQuery.data?.teams.filter((team) => team.active) ?? []
    const matchedTeam = teams.find((team) => context.includes(team.name.toLowerCase()))
    const league = matchedTeam
      ? catalogueOptionsQuery.data?.leagues.find((entry) => entry.id === matchedTeam.leagueId)
      : catalogueOptionsQuery.data?.leagues.find((entry) => entry.active && context.includes(entry.name.toLowerCase()))
    const explicitJerseyCategory = catalogueOptionsQuery.data?.jerseyCategories.find((category) =>
      category.active && context.includes(category.name.toLowerCase()))
    const normalizedStoreCategoryHint = matchedTeam ? 'club' : context.includes('training') ? 'training' : ''
    const storeCategory = normalizedStoreCategoryHint
      ? (categoriesQuery.data ?? []).find((category) => String(category.name ?? '').toLowerCase().includes(normalizedStoreCategoryHint))
      : undefined
    return { team: matchedTeam, league, jerseyCategory: explicitJerseyCategory, storeCategory, recommendsClubCollection: Boolean(matchedTeam) }
  }, [productName, productDescription, catalogueOptionsQuery.data, categoriesQuery.data])
  const selectedTeam = catalogueOptionsQuery.data?.teams.find((team) => team.id === Number(selectedTeamId))
  const selectedJerseyCategory = catalogueOptionsQuery.data?.jerseyCategories.find((category) => category.id === Number(selectedJerseyCategoryId))
  const proposedProductSlug = productSlug(productName, selectedTeam?.slug ?? '', productSeason, selectedJerseyCategory?.slug ?? '')
  const existingKit = productName.trim() && selectedTeamId && selectedJerseyCategoryId && productSeason
    ? (productsQuery.data ?? []).find((product) =>
      product.slug === proposedProductSlug
      || (String(product.name).trim().toLowerCase() === productName.trim().toLowerCase()
        && Number(product.teamId) === Number(selectedTeamId)
        && Number(product.jerseyCategoryId) === Number(selectedJerseyCategoryId)
        && String(product.season ?? '') === productSeason))
    : undefined
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    if (section === 'products' && form.getAll('variants').length === 0) {
      setError('Select at least one available size.')
      return
    }
    if (section === 'products' && existingKit) {
      setError('This kit is already in the catalogue. Choose Manage existing kit instead of submitting it again.')
      return
    }
    if (section === 'products' && productImage && (!['image/jpeg', 'image/png', 'image/webp'].includes(productImage.type) || productImage.size > 8 * 1024 * 1024)) {
      setError('Choose a JPEG, PNG, or WebP image smaller than 8 MB.')
      return
    }
    let url = ''
    let body: AdminRecord = {}
    if (section === 'categories') {
      url = '/api/v1/admin/categories'
      body = { name: form.get('name'), slug: String(form.get('name')).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), sortOrder: Number(form.get('sortOrder') || 0), active: true }
    } else if (section === 'delivery') {
      url = '/api/v1/admin/delivery/zones'
      body = { name: form.get('name'), fee: form.get('fee'), active: true }
    } else if (section === 'expenses') {
      url = '/api/v1/admin/expenses'
      body = { description: form.get('description'), amount: form.get('amount'), incurredAt: new Date(String(form.get('incurredAt'))).toISOString() }
    } else if (section === 'products') {
      url = '/api/v1/admin/products'
      const name = String(form.get('name'))
      const formTeam = catalogueOptionsQuery.data?.teams.find((team) => team.id === Number(form.get('teamId')))
      const formJerseyCategory = catalogueOptionsQuery.data?.jerseyCategories.find((category) => category.id === Number(form.get('jerseyCategoryId')))
      const slug = productSlug(name, formTeam?.slug ?? '', String(form.get('season') ?? ''), formJerseyCategory?.slug ?? '')
      if (!slug) {
        setError('Product name must include at least one English letter or number.')
        return
      }
      body = {
        name,
        slug,
        description: form.get('description'),
        price: form.get('price'),
        salePrice: String(form.get('salePrice') ?? '').trim() || null,
        season: String(form.get('season') ?? '').trim() || null,
        productType: String(form.get('productType') ?? '').trim() || null,
        imageUrl: String(form.get('imageUrl') ?? '').trim() || null,
        categoryId: Number(form.get('categoryId')) || null,
        leagueId: Number(form.get('leagueId')) || null,
        teamId: Number(form.get('teamId')) || null,
        jerseyCategoryId: Number(form.get('jerseyCategoryId')) || null,
        featured: form.get('featured') === 'on',
        published: true,
        trending: form.get('trending') === 'on',
        variants: form.getAll('variants').map(String).filter(Boolean).map((size) => ({
          size,
          sku: variantSku(slug, size),
          stock: Number(form.get(`initialStock-${size}`) ?? 0),
          price: String(form.get(`variantPrice-${size}`) ?? '').trim() || null,
        })),
      }
    } else if (section === 'settings') {
      url = '/api/v1/admin/settings'
      body = {
        businessName: form.get('businessName'), tagline: form.get('tagline'), contactEmail: form.get('contactEmail'),
        contactPhone: form.get('contactPhone'), whatsappNumber: form.get('whatsappNumber'), instagramUrl: form.get('instagramUrl'),
        dispatchTown: form.get('dispatchTown'), mpesaTillName: form.get('mpesaTillName'), mpesaTillNumber: form.get('mpesaTillNumber'), mpesaMobileNumber: form.get('mpesaMobileNumber'),
      }
    }
    setBusy(true)
    setError('')
    let createdProductId: number | undefined
    try {
      const result = await api<{ id?: number }>(url, { method: section === 'settings' ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      if (section === 'products') createdProductId = result.id
      if (section === 'products' && productImage && createdProductId) {
        try {
          await api(`/api/v1/admin/products/${createdProductId}/images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Image-Alt': productImageAlt.trim() || `${productName} football kit` },
            body: productImage,
          })
        } catch (issue) {
          formElement.reset()
          setSelectedLeagueId('')
          setSelectedTeamId('')
          setSelectedJerseyCategoryId('')
          setSelectedStoreCategoryId('')
          setSelectedSizes([])
          setProductName('')
          setProductDescription('')
          setProductSeason('')
          setProductImage(null)
          setProductImageAlt('')
          let refreshWarning = ''
          try {
            await onDone(createdProductId)
          } catch (refreshIssue) {
            refreshWarning = ` The admin list could not refresh: ${refreshIssue instanceof Error ? refreshIssue.message : 'Refresh failed.'}`
          }
          setError(`The kit was created, but its image upload failed: ${issue instanceof Error ? issue.message : 'Upload failed.'} The created kit is selected in Product image gallery so you can retry without creating it again.${refreshWarning}`)
          return
        }
      }
      formElement.reset()
      if (section === 'products') {
        setSelectedLeagueId('')
        setSelectedTeamId('')
        setSelectedJerseyCategoryId('')
        setSelectedStoreCategoryId('')
        setSelectedSizes([])
        setProductName('')
        setProductDescription('')
        setProductSeason('')
        setProductImage(null)
        setProductImageAlt('')
      }
      try {
        await onDone(createdProductId)
      } catch (issue) {
        if (section !== 'products') throw issue
        setError(`The kit was created successfully, but the product list could not refresh: ${issue instanceof Error ? issue.message : 'Refresh failed.'} Do not submit again; reload Products to see it.`)
      }
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : 'Could not save this record.'
      if (section === 'products' && message.toLowerCase().includes('already in the catalogue')) {
        try {
          await productsQuery.refetch()
          setError(`${message} Existing products have been refreshed; choose Manage existing kit below.`)
        } catch (refreshIssue) {
          setError(`${message} Could not refresh the product list: ${refreshIssue instanceof Error ? refreshIssue.message : 'Refresh failed.'}`)
        }
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }
  if (!['categories', 'delivery', 'expenses', 'products', 'settings'].includes(section)) return null
  return <form key={section === 'settings' ? settingsQuery.dataUpdatedAt : section} className="admin-create-form" onSubmit={(event) => void submit(event)}>
    {section === 'categories' && <><h2>Add kit collection</h2><label>Collection name<input name="name" required maxLength={120} placeholder="Club kits, National teams, Retro, Training" /></label><label>Display order<input name="sortOrder" type="number" min="0" defaultValue="0" /></label></>}
    {section === 'delivery' && <><h2>Add delivery area</h2><label>Area name<input name="name" required maxLength={120} placeholder="Town or delivery zone" /></label><label>Delivery fee (KES)<input name="fee" type="number" min="0" step=".01" required /></label></>}
    {section === 'expenses' && <><h2>Record business expense</h2><label>Description<input name="description" required maxLength={240} /></label><label>Amount (KES)<input name="amount" type="number" min=".01" step=".01" required /></label><label>Expense date<input name="incurredAt" type="datetime-local" required /></label></>}
    {section === 'products' && <>
      <h2>Add jersey to catalogue</h2>
      <label>Product / team jersey name<input name="name" value={productName} onChange={(event) => setProductName(event.target.value)} required maxLength={180} /></label>
      <label>Description<textarea name="description" value={productDescription} onChange={(event) => setProductDescription(event.target.value)} required minLength={5} maxLength={10000} rows={3} /></label>
      {productSuggestions && <aside className="admin-category-suggestions" aria-live="polite"><strong>Category suggestions</strong><p>Based on the product name and description. Review each suggestion before applying.</p>
        <div>{productSuggestions.league && <button type="button" onClick={() => { setSelectedLeagueId(String(productSuggestions.league?.id)); setSelectedTeamId(productSuggestions.team ? String(productSuggestions.team.id) : '') }}>League · {productSuggestions.league.name}{productSuggestions.team ? ` / ${productSuggestions.team.name}` : ''} <span>Apply</span></button>}
          {productSuggestions.jerseyCategory && <button type="button" onClick={() => setSelectedJerseyCategoryId(String(productSuggestions.jerseyCategory?.id))}>Jersey type · {productSuggestions.jerseyCategory.name} <span>Apply</span></button>}
          {productSuggestions.storeCategory && <button type="button" onClick={() => setSelectedStoreCategoryId(String(productSuggestions.storeCategory?.id))}>Store collection · {String(productSuggestions.storeCategory.name)} <span>Apply</span></button>}
          {productSuggestions.recommendsClubCollection && !productSuggestions.storeCategory && <span className="admin-category-hint">Suggested collection: Club kits. Add that collection in Categories to select it.</span>}
          {productSuggestions.team && !productSuggestions.jerseyCategory && <span className="admin-category-hint">Choose Home, Away, Third, or another jersey type manually; the description does not identify the kit edition.</span>}
          {!productSuggestions.league && !productSuggestions.jerseyCategory && !productSuggestions.storeCategory && !productSuggestions.recommendsClubCollection && <span className="admin-category-hint">No reliable team or category match yet. Keep typing or choose the classifications below.</span>}
        </div>
      </aside>}
      <label>Price (KES)<input name="price" type="number" min=".01" step=".01" required /></label>
      <label>Sale price (KES)<input name="salePrice" type="number" min=".01" step=".01" /></label>
      <label>Season<select name="season" required value={productSeason} onChange={(event) => setProductSeason(event.target.value)}><option value="" disabled>Select a season</option>{availableProductSeasons(catalogueOptionsQuery.data?.leagues ?? []).map((season) => <option key={season} value={season}>{season}</option>)}</select></label>
      <label>Product type<input name="productType" maxLength={40} placeholder="Optional details" /></label>
      <label>Image URL (HTTPS)<input name="imageUrl" type="url" /></label>
      <label>Kit image (optional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setProductImage(event.currentTarget.files?.[0] ?? null)} /></label>
      <label>Image description<input value={productImageAlt} onChange={(event) => setProductImageAlt(event.target.value)} maxLength={240} placeholder={productName ? `${productName} football kit` : 'Front view of the kit'} /></label>
      <p className="admin-form-note">Choose an image here to upload it as soon as the kit is created. JPEG, PNG, or WebP, up to 8 MB.</p>
      <fieldset className="admin-size-picker"><legend>Available sizes</legend><div>{productSizes.map((size) => <label key={size} className={selectedSizes.includes(size) ? 'is-selected' : ''}><input type="checkbox" checked={selectedSizes.includes(size)} onChange={(event) => setSelectedSizes((sizes) => event.target.checked ? [...sizes, size] : sizes.filter((item) => item !== size))} /><span>{size}</span></label>)}</div>{selectedSizes.map((size) => <input key={size} type="hidden" name="variants" value={size} />)}{selectedSizes.length === 0 && <span className="admin-size-help">Select one or more sizes and set the quantity available for each.</span>}</fieldset>
      {selectedSizes.length > 0 && <fieldset className="admin-opening-stock"><legend>Opening stock by size</legend><div>{selectedSizes.map((size) => <label key={size}>{size}<input type="number" name={`initialStock-${size}`} min="0" max="100000" step="1" defaultValue="0" required aria-label={`Opening stock for size ${size}`} /></label>)}</div><small>Sizes with a quantity above zero show as in stock when published.</small></fieldset>}
      {selectedSizes.length > 0 && <fieldset className="admin-variant-prices"><legend>Size prices (optional)</legend><div>{selectedSizes.map((size) => <label key={size}>{size}<input type="number" name={`variantPrice-${size}`} min="0.01" max="99999999" step="0.01" placeholder="Product price" aria-label={`Price override for size ${size}`} /></label>)}</div><small>Leave blank to use the product price or sale price above.</small></fieldset>}
      <label>League<select name="leagueId" value={selectedLeagueId} required onChange={(event) => { setSelectedLeagueId(event.target.value); setSelectedTeamId('') }}><option value="">Select a league</option>{(catalogueOptionsQuery.data?.leagues ?? []).filter((league) => league.active).map((league) => <option key={league.id} value={league.id}>{league.name} · {league.country}</option>)}</select></label>
      <label>Team<select name="teamId" value={selectedTeamId} disabled={!selectedLeagueId} required onChange={(event) => setSelectedTeamId(event.target.value)}><option value="">{selectedLeagueId ? 'Select a team' : 'Select a league first'}</option>{(catalogueOptionsQuery.data?.teams ?? []).filter((team) => team.active && team.leagueId === Number(selectedLeagueId)).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label>Jersey category<select name="jerseyCategoryId" required value={selectedJerseyCategoryId} onChange={(event) => setSelectedJerseyCategoryId(event.target.value)}><option value="" disabled>Select a jersey category</option>{(catalogueOptionsQuery.data?.jerseyCategories ?? []).filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>Kit collection<select name="categoryId" value={selectedStoreCategoryId} onChange={(event) => setSelectedStoreCategoryId(event.target.value)}><option value="">No collection</option>{(categoriesQuery.data ?? []).filter((category) => category.active !== false).map((category) => <option key={String(category.id)} value={String(category.id)}>{pretty(category.name)}</option>)}</select></label>
      {existingKit && <div className="admin-existing-kit" role="status"><span><strong>This kit already exists</strong> {String(existingKit.name)} is already in the catalogue for this team, season, and jersey type.</span><button type="button" onClick={() => { if (Number(existingKit.id)) void onDone(Number(existingKit.id)) }}>Manage existing kit</button></div>}
      {productsQuery.isError && <p className="admin-error">{productsQuery.error.message}. Duplicate checks are unavailable; the server will still prevent duplicate uploads.</p>}
      {catalogueOptionsQuery.isError && <p className="admin-error">{catalogueOptionsQuery.error.message}</p>}
      {categoriesQuery.isError && <p className="admin-error">{categoriesQuery.error.message}</p>}
      <label className="admin-checkbox-label"><input name="featured" type="checkbox" /> Feature on storefront</label>
      <label className="admin-checkbox-label"><input name="trending" type="checkbox" /> Mark as trending</label>
      <p className="admin-form-note">Select a season, league, team, jersey type and available sizes so customers can find this kit in Marketplace.</p>
    </>}
    {section === 'settings' && <><h2>Brand and business details</h2>{settingsQuery.isError && <p className="admin-error">{settingsQuery.error.message}</p>}<label>Business name<input name="businessName" maxLength={120} defaultValue={settingsQuery.data?.businessName ?? ''} /></label><label>Tagline<input name="tagline" maxLength={240} defaultValue={settingsQuery.data?.tagline ?? ''} /></label><label>Contact email<input name="contactEmail" type="email" maxLength={254} defaultValue={settingsQuery.data?.contactEmail ?? ''} /></label><label>Contact phone<input name="contactPhone" maxLength={30} defaultValue={settingsQuery.data?.contactPhone ?? ''} /></label><label>WhatsApp number<input name="whatsappNumber" maxLength={30} defaultValue={settingsQuery.data?.whatsappNumber ?? ''} /></label><label>Instagram URL<input name="instagramUrl" type="url" defaultValue={settingsQuery.data?.instagramUrl ?? ''} /></label><label>Dispatch town<input name="dispatchTown" maxLength={120} defaultValue={settingsQuery.data?.dispatchTown ?? ''} /></label><h2>M-Pesa payment details</h2><label>Till display name<input name="mpesaTillName" maxLength={120} defaultValue={settingsQuery.data?.mpesaTillName ?? ''} placeholder="Name customers should see" /></label><label>Buy Goods Till number<input name="mpesaTillNumber" inputMode="numeric" pattern="[0-9]{5,20}" maxLength={20} defaultValue={settingsQuery.data?.mpesaTillNumber ?? ''} placeholder="Enter Till number" /></label><label>Business M-Pesa mobile number<input name="mpesaMobileNumber" type="tel" inputMode="tel" pattern="(?:\+?254|0)[17][0-9]{8}" maxLength={13} defaultValue={settingsQuery.data?.mpesaMobileNumber ?? ''} placeholder="0712345678 or +254712345678" /></label><p className="admin-form-note">The mobile number is shown as a manual payment destination. Manual transfers are not automatically verified; the existing STK prompt and callback continue to handle automated payments. Daraja credentials belong in the server environment.</p></>}
    {error && <p className="admin-error" role="alert">{error}</p>}<button className="button button-green" disabled={busy}>{busy ? 'Saving…' : 'Save'} <ArrowRight size={15} /></button>
  </form>
}

type AdminProduct = { id: number; name: string; images?: ProductImage[]; videos?: ProductVideo[]; variants?: { id: number; size: string; stock: number }[] }
type ProductImage = { id: number; imageUrl: string; altText: string; sortOrder: number; isPrimary: boolean }
type ProductVideo = { id: number; videoUrl: string; title: string; sortOrder: number }
type HomepageSlide = {
  id: number
  imageUrl: string
  displayDurationSeconds: number
  title: string
  subtitle: string
  promotionalMessage: string | null
  ctaLabel: string
  destinationUrl: string
  sortOrder: number
  active: boolean
}

function isHomepageSlide(record: AdminRecord): record is AdminRecord & HomepageSlide {
  return typeof record.id === 'number'
    && typeof record.imageUrl === 'string'
    && typeof record.title === 'string'
    && typeof record.subtitle === 'string'
    && typeof record.ctaLabel === 'string'
    && typeof record.destinationUrl === 'string'
    && typeof record.sortOrder === 'number'
    && typeof record.active === 'boolean'
}

type AdminSupportRequest = {
  id: number
  customerId: number
  customerName: string
  customerEmail: string
  orderNumber: string | null
  category: string
  subject: string
  message: string
  status: string
  adminResponse: string | null
  messageCount: number
  unreadCount: number
  createdAt: string
  updatedAt: string
}
type AdminSupportMessage = {
  id: number
  senderType: 'customer' | 'admin'
  body: string
  latitude: string | null
  longitude: string | null
  productName: string | null
  productPrice: string | null
  productImageUrl: string | null
  productUrl: string | null
  deliveredAt: string | null
  readAt: string | null
  createdAt: string
}

function isAdminSupportRequest(record: AdminRecord): record is AdminRecord & AdminSupportRequest {
  return typeof record.id === 'number'
    && typeof record.customerId === 'number'
    && typeof record.customerName === 'string'
    && typeof record.customerEmail === 'string'
    && typeof record.category === 'string'
    && typeof record.subject === 'string'
    && typeof record.message === 'string'
    && typeof record.status === 'string'
}

function AdminSupportConversation({ request }: { request: AdminSupportRequest }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  const messagesQuery = useQuery({
    queryKey: ['admin', 'support-messages', request.id],
    queryFn: () => api<AdminSupportMessage[]>(`/api/v1/admin/support/${request.id}/messages`),
  })
  const messages = messagesQuery.data ?? [
    { id: -request.id, senderType: 'customer' as const, body: request.message, latitude: null, longitude: null, productName: null, productPrice: null, productImageUrl: null, productUrl: null, deliveredAt: null, readAt: null, createdAt: request.createdAt },
    ...(request.adminResponse ? [{ id: -request.id - 1, senderType: 'admin' as const, body: request.adminResponse, latitude: null, longitude: null, productName: null, productPrice: null, productImageUrl: null, productUrl: null, deliveredAt: null, readAt: null, createdAt: request.createdAt }] : []),
  ]
  const customerPin = [...messages].reverse().find((entry) => entry.senderType === 'customer' && entry.latitude !== null && entry.longitude !== null)
  const courierPin = [...messages].reverse().find((entry) => entry.senderType === 'admin' && entry.latitude !== null && entry.longitude !== null)
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    if (messagesQuery.data) void queryClient.invalidateQueries({ queryKey: ['admin', 'support'] })
  }, [messagesQuery.data])

  async function send(body: string, location?: { latitude: number; longitude: number }) {
    if (!navigator.onLine) {
      setError('You are offline. Your message is still in the composer; reconnect to send it.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api(`/api/v1/admin/support/${request.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body, ...location }),
      })
      setDraft('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'support-messages', request.id] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'support'] }),
      ])
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Reply could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  async function copyMessage(body: string) {
    try {
      await navigator.clipboard.writeText(body)
      setError('Message copied')
      window.setTimeout(() => setError(''), 1800)
    } catch {
      setError('Could not copy this message in your browser.')
    }
  }

  async function deleteMessage(messageId: number) {
    if (!window.confirm('Delete this message for both sides?')) return
    setError('')
    try {
      await api(`/api/v1/admin/support/${request.id}/messages/${messageId}`, { method: 'DELETE' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'support-messages', request.id] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'support'] }),
      ])
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Message could not be deleted.')
    }
  }

  function shareCourierLocation() {
    if (!navigator.geolocation) {
      setError('Location sharing is not available in this browser.')
      return
    }
    setBusy(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      (position) => void send('Latest delivery location shared.', { latitude: position.coords.latitude, longitude: position.coords.longitude }),
      (cause) => {
        setBusy(false)
        setError(cause.code === cause.PERMISSION_DENIED ? 'Allow location access in your browser to share the courier pin.' : 'The current location could not be found.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }

  return <section className="portal-chat admin-chat">
    <div ref={messagesRef} className="portal-chat-messages" aria-label={`Conversation with ${request.customerName}`}>
      {messagesQuery.isError && <p className="admin-error" role="alert">{messagesQuery.error.message}</p>}
      {customerPin && courierPin && <GoogleMapView latitude={Number(courierPin.latitude)} longitude={Number(courierPin.longitude)} destination={{ latitude: Number(customerPin.latitude), longitude: Number(customerPin.longitude) }} title="Courier route to customer" />}
      {messages.map((entry) => <article className={`portal-chat-message ${entry.senderType === 'admin' ? 'from-customer' : 'from-admin'}`} key={entry.id}>
        <span className="portal-chat-message-by">{entry.senderType === 'admin' ? 'You' : request.customerName}</span>
        <p>{entry.body}</p>
        {entry.productName && <Link className="chat-product-preview" to={entry.productUrl ?? '/admin/support'}><img src={entry.productImageUrl ?? '/culture-mark.webp'} alt="" /><span><strong>{entry.productName}</strong><small>{entry.productPrice ? new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(entry.productPrice)) : 'KitCulture kit'}</small></span><ArrowRight size={15} /></Link>}
        <div className="chat-message-actions"><button type="button" title="Copy message" aria-label="Copy message" onClick={() => void copyMessage(entry.body)}><Copy size={14} /></button>{entry.senderType === 'admin' && <button type="button" title="Delete message" aria-label="Delete message" onClick={() => void deleteMessage(entry.id)}><Trash2 size={14} /></button>}</div>
        <span className="portal-chat-message-meta"><time>{new Date(entry.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</time>{entry.senderType === 'admin' && <small className={`portal-chat-receipt${entry.readAt ? ' is-read' : ''}`} title={entry.readAt ? `Read ${new Date(entry.readAt).toLocaleString()}` : entry.deliveredAt ? `Delivered ${new Date(entry.deliveredAt).toLocaleString()}` : 'Sent'}>{entry.readAt ? '✓✓' : entry.deliveredAt ? '✓✓' : '✓'}</small>}</span>
        {entry.latitude !== null && entry.longitude !== null && <GoogleMapView latitude={Number(entry.latitude)} longitude={Number(entry.longitude)} title={entry.senderType === 'admin' ? 'Shared courier location' : 'Customer location pin'} />}
      </article>)}
      {messagesQuery.isPending && <p className="admin-empty">Loading conversation…</p>}
    </div>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <form className="portal-chat-compose" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) void send(draft.trim()) }}>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (draft.trim() && !busy) void send(draft.trim()) } }} placeholder="Type a message" rows={1} maxLength={2000} aria-label="Reply to customer" />
      <div className="portal-chat-compose-actions"><button type="button" className="portal-chat-icon-action" disabled={busy || !request.orderNumber} title={!request.orderNumber ? 'Attach a delivery order to share tracking locations.' : 'Share courier location'} aria-label="Share courier location" onClick={shareCourierLocation}><MapPin size={19} /></button><button type="submit" className="portal-chat-send" disabled={busy || !draft.trim()} title="Send message" aria-label="Send message"><Send size={18} /></button></div>
    </form>
  </section>
}

function SupportRequestsManager({ requests, onDone }: { requests: AdminSupportRequest[]; onDone: () => Promise<void> }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [selectedChatId, setSelectedChatId] = useState<number | null>(requests[0]?.id ?? null)
  const [search, setSearch] = useState('')
  const [threadOpen, setThreadOpen] = useState(false)
  const [onlineCustomerIds, setOnlineCustomerIds] = useState<number[]>([])
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine)
  const [streamConnected, setStreamConnected] = useState(false)
  const chatListRef = useRef<HTMLDivElement>(null)
  const selectedRequest = requests.find((request) => request.id === selectedChatId) ?? requests[0]
  const visibleRequests = requests
    .filter((request) => `${request.customerName} ${request.customerEmail} ${request.subject} ${request.category} ${request.message}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((first, second) => Number(second.id === selectedChatId) - Number(first.id === selectedChatId)
      || Number(onlineCustomerIds.includes(second.customerId)) - Number(onlineCustomerIds.includes(first.customerId))
      || Date.parse(second.updatedAt) - Date.parse(first.updatedAt))

  useEffect(() => {
    const stream = new EventSource('/api/v1/admin/support/events')
    const onPresence = (event: MessageEvent<string>) => {
      const data = JSON.parse(event.data) as { onlineCustomerIds?: number[] }
      setOnlineCustomerIds(data.onlineCustomerIds ?? [])
    }
    const onChatMessage = (event: MessageEvent<string>) => {
      const data = JSON.parse(event.data) as { conversationId: number }
      void queryClient.invalidateQueries({ queryKey: ['admin', 'support-messages', data.conversationId] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'support'] })
    }
    const onMessageReceipt = (event: MessageEvent<string>) => {
      const data = JSON.parse(event.data) as { conversationId: number }
      void queryClient.invalidateQueries({ queryKey: ['admin', 'support-messages', data.conversationId] })
    }
    const onOnline = () => {
      setBrowserOnline(true)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'support'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'support-messages'] })
    }
    const onOffline = () => setBrowserOnline(false)
    stream.onopen = () => setStreamConnected(true)
    stream.onerror = () => setStreamConnected(false)
    stream.addEventListener('presence', onPresence as EventListener)
    stream.addEventListener('chat-message', onChatMessage as EventListener)
    stream.addEventListener('message-receipt', onMessageReceipt as EventListener)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      stream.close()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [queryClient])

  useEffect(() => {
    if (selectedRequest && selectedRequest.id !== selectedChatId) setSelectedChatId(selectedRequest.id)
  }, [selectedRequest, selectedChatId])

  useEffect(() => {
    chatListRef.current?.scrollTo({ top: 0 })
  }, [selectedChatId])

  async function updateRequest(event: FormEvent<HTMLFormElement>, request: AdminSupportRequest) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError('')
    setBusyId(request.id)
    try {
      await api(`/api/v1/admin/support/${request.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: form.get('status'),
        }),
      })
      await onDone()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Support request could not be updated.')
    } finally {
      setBusyId(null)
    }
  }

  return <section className="admin-support-list">
    {error && <p className="admin-error" role="alert">{error}</p>}
    <section className={`portal-messenger portal-chat-workspace admin-messenger${threadOpen ? ' is-thread-open' : ''}`} aria-label="Customer conversations">
      <aside className="portal-messenger-list">
        <header><h2>Chats</h2><span>{requests.length}</span></header>
        <label className="portal-messenger-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers" aria-label="Search customer conversations" /></label>
        <div className="admin-chat-list-items" ref={chatListRef}>
        {!requests.length ? <p className="portal-messenger-state">No customer conversations yet.</p>
          : visibleRequests.length ? visibleRequests.map((request) => <button type="button" className={`portal-messenger-item${selectedRequest?.id === request.id ? ' is-active' : ''}`} key={request.id} onClick={() => { setSelectedChatId(request.id); setThreadOpen(true); chatListRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) }}>
            <span className="portal-messenger-avatar-wrap"><span className="portal-messenger-avatar portal-chat-avatar">{request.customerName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>{onlineCustomerIds.includes(request.customerId) && <span className="portal-messenger-online-dot" aria-label="Online" />}</span>
            <span className="portal-messenger-item-copy"><strong>{request.customerName}</strong><small><span className={onlineCustomerIds.includes(request.customerId) ? 'chat-online-label' : 'chat-offline-label'}>{onlineCustomerIds.includes(request.customerId) ? 'Online' : 'Offline'}</span> · {request.messageCount} texts · {request.unreadCount} unread</small><small>{request.subject} · {request.adminResponse ?? request.message}</small></span>
            <time>{new Date(request.updatedAt).toLocaleDateString()}</time>
          </button>)
            : <p className="portal-messenger-state">No matching conversations.</p>}
        </div>
      </aside>
      <section className="portal-messenger-thread" aria-label={selectedRequest ? `Conversation with ${selectedRequest.customerName}` : 'No conversation selected'}>
        {selectedRequest ? <>
          <header className="portal-messenger-thread-header"><button type="button" className="portal-messenger-back" aria-label="Back to chats" onClick={() => setThreadOpen(false)}><ArrowRight size={18} /></button><span className="portal-messenger-avatar-wrap"><span className="portal-messenger-avatar portal-chat-avatar">{selectedRequest.customerName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>{onlineCustomerIds.includes(selectedRequest.customerId) && <span className="portal-messenger-online-dot" aria-label="Online" />}</span><span><strong>{selectedRequest.customerName}</strong><small>{!browserOnline ? 'You are offline' : !streamConnected ? 'Reconnecting…' : onlineCustomerIds.includes(selectedRequest.customerId) ? 'Online now' : 'Offline'} · {selectedRequest.customerEmail} · {selectedRequest.orderNumber ? `Order ${selectedRequest.orderNumber}` : 'General support'}</small><small>{selectedRequest.messageCount} texts · {selectedRequest.unreadCount} unread</small></span><span className={`portal-status portal-status-${selectedRequest.status.replaceAll('_', '-')}`}>{selectedRequest.status.replaceAll('_', ' ')}</span></header>
          <form key={`status-${selectedRequest.id}`} className="admin-support-status-form admin-messenger-status" onSubmit={(event) => void updateRequest(event, selectedRequest)}>
            <label>Status<select name="status" defaultValue={selectedRequest.status === 'pending' ? 'in_progress' : selectedRequest.status}><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label>
            <button className="button button-green" disabled={busyId === selectedRequest.id}>{busyId === selectedRequest.id ? 'Saving…' : 'Update status'} <ArrowRight size={15} /></button>
          </form>
          <AdminSupportConversation key={`conversation-${selectedRequest.id}`} request={selectedRequest} />
        </> : <div className="portal-messenger-empty"><MessageCircle size={30} /><strong>Customer conversations</strong><p>Select a conversation to reply and view any location pins shared by the customer.</p></div>}
      </section>
    </section>
  </section>
}

function FootballCatalogueManager({ onDone }: { onDone: () => Promise<void> }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [leagueForTeam, setLeagueForTeam] = useState('')
  const optionsQuery = useQuery({
    queryKey: ['admin', 'catalogue-options'],
    queryFn: () => api<CatalogueOptions>('/api/v1/admin/catalogue-options'),
  })
  const options = optionsQuery.data

  async function submit(event: FormEvent<HTMLFormElement>, endpoint: (form: FormData) => { url: string; body: AdminRecord }) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const form = new FormData(event.currentTarget)
    const request = endpoint(form)
    try {
      await api(request.url, { method: 'POST', body: JSON.stringify(request.body) })
      event.currentTarget.reset()
      await optionsQuery.refetch()
      await onDone()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Catalogue details could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="football-catalogue-manager">
    <div className="football-catalogue-intro"><span className="admin-kicker">MARKETPLACE TAXONOMY</span><h2>Keep the leagues, clubs and kit types current.</h2><p>Add a league, a team under a league, or a jersey type. Existing products keep their links when a league is no longer active.</p></div>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {optionsQuery.isError && <p className="admin-error" role="alert">{optionsQuery.error.message}</p>}
    <div className="football-catalogue-forms">
      <form className="admin-create-form" onSubmit={(event) => void submit(event, (form) => ({
        url: '/api/v1/admin/leagues',
        body: {
          name: form.get('name'),
          slug: slugify(String(form.get('name'))),
          country: form.get('country'),
          countryCode: String(form.get('countryCode')).toUpperCase(),
          season: form.get('season'),
          sortOrder: Number(form.get('sortOrder') || 0),
          active: true,
        },
      }))}>
        <h2>Add a league</h2><label>League name<input name="name" required maxLength={120} placeholder="For example, Eredivisie" /></label><label>Country<input name="country" required maxLength={80} /></label><label>Country code<input name="countryCode" required minLength={2} maxLength={2} placeholder="NL" /></label><label>Season<input name="season" required maxLength={20} placeholder="2025/26" /></label><label>Display order<input name="sortOrder" type="number" min="0" defaultValue="0" /></label><button className="button button-green" disabled={busy}>Add league <ArrowRight size={15} /></button>
      </form>
      <form className="admin-create-form" onSubmit={(event) => void submit(event, (form) => ({
        url: `/api/v1/admin/leagues/${leagueForTeam}/teams`,
        body: { name: form.get('name'), slug: slugify(String(form.get('name'))), sortOrder: Number(form.get('sortOrder') || 0), active: true },
      }))}>
        <h2>Add a team</h2><label>League<select value={leagueForTeam} onChange={(event) => setLeagueForTeam(event.target.value)} required><option value="">Select a league</option>{options?.leagues.map((league) => <option key={league.id} value={league.id}>{league.name} · {league.season}</option>)}</select></label><label>Team name<input name="name" required maxLength={120} placeholder="For example, Ajax" /></label><label>Display order<input name="sortOrder" type="number" min="0" defaultValue="0" /></label><button className="button button-green" disabled={busy || !leagueForTeam}>Add team <ArrowRight size={15} /></button>
      </form>
      <form className="admin-create-form" onSubmit={(event) => void submit(event, (form) => ({
        url: '/api/v1/admin/jersey-categories',
        body: { name: form.get('name'), slug: slugify(String(form.get('name'))), sortOrder: Number(form.get('sortOrder') || 0), active: true },
      }))}>
        <h2>Add a jersey type</h2><label>Jersey category<input name="name" required maxLength={80} placeholder="For example, Pre-match" /></label><label>Display order<input name="sortOrder" type="number" min="0" defaultValue="0" /></label><button className="button button-green" disabled={busy}>Add jersey type <ArrowRight size={15} /></button>
      </form>
    </div>
    {options && <div className="football-catalogue-current"><div><h2>Leagues and teams</h2>{options.leagues.map((league) => <article key={league.id}><strong>{league.name}</strong><small>{league.country} · {league.season}</small><p>{options.teams.filter((team) => team.leagueId === league.id).map((team) => team.name).join(' · ') || 'No teams added yet.'}</p></article>)}</div><div><h2>Jersey categories</h2><ul>{options.jerseyCategories.map((category) => <li key={category.id}>{category.name}</li>)}</ul></div></div>}
  </section>
}

type CatalogProduct = AdminProduct & {
  price: string
  salePrice: string | null
  categoryId: number | null
  published: boolean
  featured: boolean
  trending: boolean
  teamId: number | null
  jerseyCategoryId: number | null
  team: CatalogueTeam | null
  league: CatalogueLeague | null
  jerseyCategory: CatalogueJerseyCategory | null
}

function ProductClassificationManager({ onDone }: { onDone: () => Promise<void> }) {
  const [selectedProduct, setSelectedProduct] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [leagueId, setLeagueId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [jerseyCategoryId, setJerseyCategoryId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const productsQuery = useQuery({ queryKey: ['admin', 'products'], queryFn: () => api<CatalogProduct[]>('/api/v1/admin/products') })
  const optionsQuery = useQuery({ queryKey: ['admin', 'catalogue-options'], queryFn: () => api<CatalogueOptions>('/api/v1/admin/catalogue-options') })
  const categoriesQuery = useQuery({ queryKey: ['admin', 'categories'], queryFn: () => api<AdminRecord[]>('/api/v1/admin/categories') })
  const product = productsQuery.data?.find((entry) => String(entry.id) === selectedProduct)

  function chooseProduct(id: string) {
    setSelectedProduct(id)
    const chosen = productsQuery.data?.find((entry) => String(entry.id) === id)
    setCategoryId(chosen?.categoryId ? String(chosen.categoryId) : '')
    setLeagueId(chosen?.league ? String(chosen.league.id) : '')
    setTeamId(chosen?.teamId ? String(chosen.teamId) : '')
    setJerseyCategoryId(chosen?.jerseyCategoryId ? String(chosen.jerseyCategoryId) : '')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!product) return
    setError('')
    setBusy(true)
    try {
      await api(`/api/v1/admin/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          leagueId: Number(leagueId) || null,
          teamId: Number(teamId) || null,
          jerseyCategoryId: Number(jerseyCategoryId) || null,
          categoryId: Number(categoryId) || null,
        }),
      })
      await productsQuery.refetch()
      await onDone()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Jersey classification could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="admin-create-form admin-product-manager">
    <h2>Kit collection, league, team and jersey type</h2>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {(productsQuery.isError || optionsQuery.isError || categoriesQuery.isError) && <p className="admin-error" role="alert">{productsQuery.error?.message ?? optionsQuery.error?.message ?? categoriesQuery.error?.message}</p>}
    <form className="admin-classification-form" onSubmit={(event) => void save(event)}>
      <label>Product<select value={selectedProduct} onChange={(event) => chooseProduct(event.target.value)} required><option value="">Select a jersey</option>{productsQuery.data?.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <label>Kit collection<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">No collection</option>{categoriesQuery.data?.filter((category) => category.active !== false).map((category) => <option key={String(category.id)} value={String(category.id)}>{pretty(category.name)}</option>)}</select></label>
      <label>League<select value={leagueId} onChange={(event) => { setLeagueId(event.target.value); setTeamId('') }}><option value="">No league</option>{optionsQuery.data?.leagues.filter((league) => league.active).map((league) => <option key={league.id} value={league.id}>{league.name} · {league.country}</option>)}</select></label>
      <label>Team<select value={teamId} disabled={!leagueId} required={Boolean(leagueId)} onChange={(event) => setTeamId(event.target.value)}><option value="">{leagueId ? 'Select a team' : 'No team'}</option>{optionsQuery.data?.teams.filter((team) => team.active && team.leagueId === Number(leagueId)).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label>Jersey type<select value={jerseyCategoryId} onChange={(event) => setJerseyCategoryId(event.target.value)}><option value="">No jersey type</option>{optionsQuery.data?.jerseyCategories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <button className="button button-green" disabled={busy || !product || Boolean(leagueId && !teamId)}>{busy ? 'Saving…' : 'Save classification'} <ArrowRight size={15} /></button>
    </form>
  </section>
}

function ProductPublishingManager({ onDone }: { onDone: () => Promise<void> }) {
  const [selectedProduct, setSelectedProduct] = useState('')
  const [collectionFilter, setCollectionFilter] = useState('')
  const [nationalTeamFilter, setNationalTeamFilter] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const productsQuery = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api<CatalogProduct[]>('/api/v1/admin/products'),
  })
  const products = productsQuery.data ?? []
  const categoriesQuery = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => api<AdminRecord[]>('/api/v1/admin/categories'),
  })
  const categories = categoriesQuery.data ?? []
  const filterCategories = categories.filter((category) => category.active !== false && category.slug !== 'club-kits')
  const nationalCollectionId = categories.find((category) => category.slug === 'national-team-kits')?.id
  const visibleProducts = products.filter((product) =>
    (!collectionFilter || String(product.categoryId) === collectionFilter)
    && (!nationalTeamFilter || (String(product.categoryId) === String(nationalCollectionId) && matchesNationalTeam(nationalTeamFilter, product.team?.name))))

  async function patchProduct(product: CatalogProduct, update: Partial<CatalogProduct>) {
    setBusy(true)
    setError('')
    try {
      await api(`/api/v1/admin/products/${product.id}`, { method: 'PATCH', body: JSON.stringify(update) })
      await productsQuery.refetch()
      await onDone()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Product update failed.')
    } finally {
      setBusy(false)
    }
  }

  async function saveSalePrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const product = products.find((entry) => String(entry.id) === selectedProduct)
    if (!product) return
    await patchProduct(product, { salePrice: salePrice.trim() || null })
  }

  return <section className="admin-create-form admin-product-manager">
    <h2>Product visibility and pricing</h2>
    <p className="admin-form-note">Out-of-stock kits stay published for customers to view. Restock their sizes from Inventory; unpublishing hides a kit from the storefront.</p>
    {productsQuery.isError && <p className="admin-error" role="alert">{productsQuery.error.message}</p>}
    {categoriesQuery.isError && <p className="admin-error" role="alert">{categoriesQuery.error.message}</p>}
    {error && <p className="admin-error" role="alert">{error}</p>}
    <div className="admin-product-filters">
      <label>Kit collection<select value={collectionFilter} onChange={(event) => setCollectionFilter(event.target.value)}><option value="">All collections</option>{filterCategories.map((category) => <option key={String(category.id)} value={String(category.id)}>{pretty(category.name)}</option>)}</select></label>
      <label>National team<select value={nationalTeamFilter} onChange={(event) => setNationalTeamFilter(event.target.value)}><option value="">All national teams</option>{NATIONAL_TEAM_NAMES.map((team) => <option key={team} value={team}>{team}</option>)}</select></label>
    </div>
    <div className="admin-product-list">
      {visibleProducts.map((product) => <article key={product.id} className="admin-product-row">
        <div><strong>{product.name}</strong><span>{pretty(product.price)} KES{product.salePrice ? ` · sale ${pretty(product.salePrice)} KES` : ''} · {product.variants?.some((variant) => variant.stock > 0) ? `${product.variants.reduce((total, variant) => total + variant.stock, 0)} units in stock` : 'Out of stock'}</span></div>
        <button type="button" className={product.published ? 'admin-icon-action is-primary' : 'admin-icon-action'} aria-pressed={product.published} disabled={busy} onClick={() => void patchProduct(product, { published: !product.published })}>{product.published ? 'Published' : 'Draft'}</button>
        <Link className="admin-icon-action" to="/admin/inventory">Manage stock</Link>
        <button type="button" className={product.featured ? 'admin-icon-action is-primary' : 'admin-icon-action'} aria-pressed={product.featured} disabled={busy} onClick={() => void patchProduct(product, { featured: !product.featured })}>{product.featured ? 'Featured' : 'Feature'}</button>
        <button type="button" className={product.trending ? 'admin-icon-action is-primary' : 'admin-icon-action'} aria-pressed={product.trending} disabled={busy} onClick={() => void patchProduct(product, { trending: !product.trending })}>{product.trending ? 'Trending' : 'Mark trending'}</button>
        <button type="button" className="admin-icon-action" onClick={() => { setSelectedProduct(String(product.id)); setSalePrice(product.salePrice ?? '') }}>Edit sale price</button>
      </article>)}
      {!visibleProducts.length && !productsQuery.isPending && <p className="admin-form-note">{products.length ? 'No products match the current filters.' : 'Create a product above to manage its storefront visibility.'}</p>}
    </div>
    {selectedProduct && <form className="admin-sale-price-form" onSubmit={(event) => void saveSalePrice(event)}>
      <label>Sale price for {products.find((product) => String(product.id) === selectedProduct)?.name ?? 'product'} (KES)<input type="number" min="0" step=".01" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} placeholder="Clear to remove the sale price" /></label>
      <button className="button button-green" disabled={busy}>{busy ? 'Saving…' : 'Save sale price'} <ArrowRight size={15} /></button>
      <button className="admin-icon-action" type="button" onClick={() => setSelectedProduct('')}>Cancel</button>
    </form>}
  </section>
}

function ProductImageManager({ onDone, initialProductId }: { onDone: () => Promise<void>; initialProductId?: number }) {
  const [selectedProduct, setSelectedProduct] = useState(initialProductId ? String(initialProductId) : '')
  const [altText, setAltText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [videoTitle, setVideoTitle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const productsQuery = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api<AdminProduct[]>('/api/v1/admin/products'),
  })
  const products = productsQuery.data ?? []
  const product = products.find((entry) => String(entry.id) === selectedProduct)
  const images = product?.images ?? []
  const videos = product?.videos ?? []

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    if (!file || !selectedProduct) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/v1/admin/products/${selectedProduct}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Image-Alt': altText },
        body: file,
      })
      setFile(null)
      setAltText('')
      form.reset()
      await productsQuery.refetch()
      await onDone()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Image upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function updateImage(image: ProductImage, update: Partial<Pick<ProductImage, 'altText' | 'sortOrder' | 'isPrimary'>>) {
    if (!selectedProduct) return
    setError('')
    try {
      await api(`/api/v1/admin/products/${selectedProduct}/images/${image.id}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      })
      await productsQuery.refetch()
      await onDone()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Image update failed.')
    }
  }

  async function removeImage(image: ProductImage) {
    if (!selectedProduct || !window.confirm('Delete this image from the product and image storage?')) return
    setError('')
    try {
      await api(`/api/v1/admin/products/${selectedProduct}/images/${image.id}`, { method: 'DELETE' })
      await productsQuery.refetch()
      await onDone()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Image deletion failed.')
    }
  }

  async function addVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    if (!selectedProduct) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/v1/admin/products/${selectedProduct}/videos`, {
        method: 'POST',
        body: JSON.stringify({ videoUrl, title: videoTitle }),
      })
      setVideoUrl('')
      setVideoTitle('')
      form.reset()
      await productsQuery.refetch()
      await onDone()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Video could not be added.')
    } finally {
      setBusy(false)
    }
  }

  async function removeVideo(video: ProductVideo) {
    if (!selectedProduct || !window.confirm(`Remove "${video.title}" from this product?`)) return
    setError('')
    try {
      await api(`/api/v1/admin/products/${selectedProduct}/videos/${video.id}`, { method: 'DELETE' })
      await productsQuery.refetch()
      await onDone()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Video could not be removed.')
    }
  }

  return <section className="admin-create-form admin-image-manager">
    <h2>Product image and video gallery</h2>
    {productsQuery.isError && <p className="admin-error" role="alert">{productsQuery.error.message}</p>}
    <label>Product<select required value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)}><option value="">Select a product</option>{products.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
    <form className="admin-image-upload" onSubmit={(event) => void upload(event)}>
      <label>Image file<input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} /></label>
      <label>Descriptive alt text<input value={altText} onChange={(event) => setAltText(event.target.value)} required minLength={2} maxLength={240} placeholder="Front view of the home shirt" /></label>
      <button className="button button-green" type="submit" disabled={busy || !file || !selectedProduct}>{busy ? 'Uploading…' : 'Upload image'} <Upload size={15} /></button>
      <p className="admin-form-note">JPEG, PNG or WebP, up to 8 MB. Persistent storage must be configured on the server.</p>
    </form>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {selectedProduct && <div className="admin-image-list">
      {!images.length && <p className="admin-form-note">No stored gallery images for this product yet.</p>}
      {images.map((image) => <article className="admin-image-item" key={image.id}>
        <img src={image.imageUrl} alt={image.altText} />
        <div className="admin-image-details">
          <label>Alt text<input aria-label={`Alt text for image ${image.id}`} defaultValue={image.altText} maxLength={240} onBlur={(event) => { if (event.target.value.trim() !== image.altText) void updateImage(image, { altText: event.target.value.trim() }) }} /></label>
          <label>Order<input aria-label={`Order for image ${image.id}`} type="number" min="0" max="10000" defaultValue={image.sortOrder} onBlur={(event) => { const sortOrder = Number(event.target.value); if (sortOrder !== image.sortOrder) void updateImage(image, { sortOrder }) }} /></label>
        </div>
        <div className="admin-image-actions">
          <button type="button" className={image.isPrimary ? 'admin-icon-action is-primary' : 'admin-icon-action'} aria-label={image.isPrimary ? 'Primary image' : 'Make primary image'} onClick={() => { if (!image.isPrimary) void updateImage(image, { isPrimary: true }) }}><Star size={16} />{image.isPrimary ? 'Primary' : 'Set primary'}</button>
          <button type="button" className="admin-icon-action is-danger" aria-label={`Delete image ${image.id}`} onClick={() => void removeImage(image)}><Trash2 size={16} />Delete</button>
        </div>
      </article>)}
    </div>}
    {selectedProduct && <>
      <form className="admin-video-form" onSubmit={(event) => void addVideo(event)}>
        <h3>Add a product video</h3>
        <label>Secure video URL<input type="url" required value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://… (MP4, YouTube, or Vimeo)" /></label>
        <label>Video title<input required minLength={2} maxLength={240} value={videoTitle} onChange={(event) => setVideoTitle(event.target.value)} placeholder="Home shirt details" /></label>
        <button className="button button-green" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add video'} <ArrowRight size={15} /></button>
        <p className="admin-form-note">Use an HTTPS MP4/WebM URL or a YouTube/Vimeo link.</p>
      </form>
      <div className="admin-video-list">
        {videos.map((video) => <article key={video.id}><span><strong>{video.title}</strong><small>{video.videoUrl}</small></span><button type="button" className="admin-icon-action is-danger" onClick={() => void removeVideo(video)} aria-label={`Remove ${video.title}`}><Trash2 size={15} />Remove</button></article>)}
        {!videos.length && <p className="admin-form-note">No product videos have been added.</p>}
      </div>
    </>}
  </section>
}

const homepageSlideDestinations = [
  { label: 'Home', value: '/' },
  { label: 'Shop jerseys', value: '/shop' },
  { label: 'Clubs', value: '/marketplace' },
  { label: 'National teams', value: '/categories/national-team-kits' },
  { label: 'New arrivals', value: '/#new-arrivals' },
  { label: 'Shopping bag', value: '/cart' },
]

function HomepageSlidesManager({ slides, onDone }: { slides: HomepageSlide[]; onDone: () => Promise<void> }) {
  const [editing, setEditing] = useState<HomepageSlide | null>(null)
  const [error, setError] = useState('')
  const [uploadStatus, setUploadStatus] = useState('')
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [imageLinks, setImageLinks] = useState('')
  const [busy, setBusy] = useState(false)

  async function uploadImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (!files.length) return
    if (files.length + imageUrls.length > 20) {
      setError('A slideshow can contain up to 20 images.')
      return
    }
    setBusy(true)
    setError('')
    setUploadStatus('')
    let uploaded = 0
    try {
      for (const file of files) {
        const result = await api<{ imageUrl: string }>('/api/v1/admin/homepage/slides/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        })
        setImageUrls((current) => [...current, result.imageUrl])
        uploaded += 1
        setUploadStatus(`${uploaded} of ${files.length} selected images uploaded.`)
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : `Image upload stopped after ${uploaded} file(s).`)
    } finally {
      setBusy(false)
    }
  }

  function addImageLinks() {
    const links = imageLinks.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)
    if (!links.length) return
    if (editing && links.length > 1) {
      setError('Edit one slide at a time. Add multiple links when creating a slideshow.')
      return
    }
    if (links.some((url) => {
      try { return new URL(url).protocol !== 'https:' } catch { return true }
    })) {
      setError('Every image link must be a valid HTTPS URL.')
      return
    }
    if (links.length + imageUrls.length > 20) {
      setError('A slideshow can contain up to 20 images.')
      return
    }
    setError('')
    setImageUrls((current) => [...current, ...links])
    setImageLinks('')
  }

  function removeImage(index: number) {
    setImageUrls((current) => current.filter((_, imageIndex) => imageIndex !== index))
  }

  function moveImage(index: number, direction: -1 | 1) {
    setImageUrls((current) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const reordered = [...current]
      const [imageUrl] = reordered.splice(index, 1)
      reordered.splice(nextIndex, 0, imageUrl)
      return reordered
    })
  }

  function editSlide(slide: HomepageSlide) {
    setEditing(slide)
    setImageUrls([slide.imageUrl])
    setImageLinks('')
    setError('')
    setUploadStatus('')
  }

  function cancelEdit() {
    setEditing(null)
    setImageUrls([])
    setImageLinks('')
    setError('')
    setUploadStatus('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    if (!imageUrls.length) {
      setError('Add at least one image link or upload an image before saving.')
      return
    }
    const form = new FormData(formElement)
    const details = {
      displayDurationSeconds: Number(form.get('displayDurationSeconds')),
      title: String(form.get('title') ?? '').trim(),
      subtitle: String(form.get('subtitle') ?? '').trim(),
      promotionalMessage: String(form.get('promotionalMessage') ?? '').trim() || null,
      ctaLabel: String(form.get('ctaLabel') ?? '').trim(),
      destinationUrl: String(form.get('destinationUrl') ?? ''),
      sortOrder: Number(form.get('sortOrder') || 0),
      active: form.get('active') === 'on',
    }
    setBusy(true)
    setError('')
    setUploadStatus('')
    try {
      if (editing) {
        await api(`/api/v1/admin/homepage/slides/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...details, imageUrl: imageUrls[0] }),
        })
      } else {
        const batch = imageUrls.map((imageUrl, index) => ({ ...details, imageUrl, sortOrder: details.sortOrder + index }))
        await api('/api/v1/admin/homepage/slides/batch', { method: 'POST', body: JSON.stringify(batch) })
      }
      setEditing(null)
      setImageUrls([])
      setImageLinks('')
      formElement.reset()
      await onDone()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Homepage slide could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(slide: HomepageSlide) {
    if (!window.confirm(`Delete the homepage slide "${slide.title}"?`)) return
    setError('')
    try {
      await api(`/api/v1/admin/homepage/slides/${slide.id}`, { method: 'DELETE' })
      if (editing?.id === slide.id) cancelEdit()
      await onDone()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Homepage slide could not be deleted.')
    }
  }

  return <section className="admin-homepage-manager">
    <div className="admin-slideshow-intro"><div><span className="admin-kicker">HOMEPAGE CREATIVE</span><h2>Build the hero slideshow</h2><p>Published slides appear automatically on the home page. The button destination only controls where each call to action leads.</p></div><span className="admin-slideshow-count">{imageUrls.length} / 20 selected</span></div>
    <form key={editing?.id ?? 'new'} className="admin-create-form admin-slideshow-form" onSubmit={(event) => void save(event)}>
      <h2>{editing ? 'Edit slide' : 'Slide content'}</h2>
      <label className="admin-slideshow-links">Image links<textarea value={imageLinks} onChange={(event) => setImageLinks(event.target.value)} rows={3} placeholder={'https://example.com/kit-1.jpg\nhttps://example.com/kit-2.jpg'} disabled={busy} /><button type="button" className="admin-icon-action" onClick={addImageLinks} disabled={busy || !imageLinks.trim()}>Add image links</button><small>Paste one HTTPS image link per line. Each link creates one slide.</small></label>
      <label className="admin-slideshow-upload">Upload kit images<input type="file" accept="image/jpeg,image/png,image/webp" multiple={!editing} disabled={busy || imageUrls.length >= 20} onChange={(event) => void uploadImages(event)} /><small>Select up to {editing ? 'one' : '20'} JPEG, PNG or WebP images. Each becomes a separate slide.</small></label>
      <div className="admin-slide-queue">
        <div className="admin-slide-queue-heading"><strong>Slideshow order</strong><span>First image appears first</span></div>
        {!imageUrls.length && <p className="admin-form-note">No images selected yet.</p>}
        {imageUrls.map((imageUrl, index) => <article className="admin-slide-queue-item" key={`${imageUrl}-${index}`}><img src={imageUrl} alt="" /><span className="admin-slide-order">{String(index + 1).padStart(2, '0')}</span><code title={imageUrl}>{imageUrl}</code><div className="admin-slide-queue-actions"><button type="button" className="admin-icon-action" aria-label={`Move slide ${index + 1} up`} onClick={() => moveImage(index, -1)} disabled={busy || index === 0}>Up</button><button type="button" className="admin-icon-action" aria-label={`Move slide ${index + 1} down`} onClick={() => moveImage(index, 1)} disabled={busy || index === imageUrls.length - 1}>Down</button><button type="button" className="admin-icon-action is-danger" onClick={() => removeImage(index)} disabled={busy}>Remove</button></div></article>)}
      </div>
      <label>Show image for (seconds)<input name="displayDurationSeconds" type="number" min="2" max="30" step="1" required defaultValue={editing?.displayDurationSeconds ?? 5} /></label>
      <label>Title<input name="title" required minLength={2} maxLength={180} defaultValue={editing?.title ?? ''} placeholder="New season kits" /></label>
      <label>Subtitle<textarea name="subtitle" required minLength={2} maxLength={500} rows={2} defaultValue={editing?.subtitle ?? ''} placeholder="Find the shirt that feels like home." /></label>
      <label>Promotion message<input name="promotionalMessage" maxLength={240} defaultValue={editing?.promotionalMessage ?? ''} placeholder="NEW SEASON" /></label>
      <label>Button label<input name="ctaLabel" required minLength={2} maxLength={80} defaultValue={editing?.ctaLabel ?? 'Shop now'} /></label>
      <label>Button destination<select name="destinationUrl" required defaultValue={editing?.destinationUrl ?? '/shop'}>
        {homepageSlideDestinations.map((destination) => <option key={destination.value} value={destination.value}>{destination.label}</option>)}
        {editing?.destinationUrl && !homepageSlideDestinations.some((destination) => destination.value === editing.destinationUrl) && <option value={editing.destinationUrl}>Current destination ({editing.destinationUrl})</option>}
      </select></label>
      <label>Display order<input name="sortOrder" type="number" min="0" max="10000" defaultValue={editing?.sortOrder ?? 0} /></label>
      <label className="admin-checkbox-label"><input name="active" type="checkbox" defaultChecked={editing?.active ?? false} /> Publish when schedule is active</label>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {uploadStatus && <p className="admin-form-note" role="status">{uploadStatus}</p>}
      <div className="admin-form-actions"><button className="button button-green" disabled={busy || !imageUrls.length}>{busy ? 'Saving…' : editing ? 'Save slide' : `Create ${imageUrls.length || ''} slide${imageUrls.length === 1 ? '' : 's'}`} <ArrowRight size={15} /></button>{editing && <button className="button button-light" type="button" onClick={cancelEdit}>Cancel edit</button>}</div>
    </form>
    <section className="admin-order-actions"><h2>Homepage slides</h2>
      {!slides.length && <div className="admin-empty">No homepage slides have been created.</div>}
      {slides.map((slide) => <article key={slide.id} className="admin-slide-row">
        <img src={slide.imageUrl} alt="" /><div><strong>{slide.title}</strong><span>{slide.active ? 'Published' : 'Draft'} · order {slide.sortOrder}</span><small>{slide.destinationUrl}</small></div>
        <button type="button" className="admin-icon-action" onClick={() => editSlide(slide)}>Edit</button>
        <button type="button" className="admin-icon-action is-danger" onClick={() => void remove(slide)}><Trash2 size={15} />Delete</button>
      </article>)}
    </section>
  </section>
}

function InventoryAdjustmentForm({ onDone }: { onDone: () => Promise<void> }) {
  const [selectedProduct, setSelectedProduct] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const productsQuery = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api<AdminRecord[]>('/api/v1/admin/products'),
  })
  const products = productsQuery.data ?? []
  const product = products.find((entry) => String(entry.id) === selectedProduct)
  const variants = Array.isArray(product?.variants) ? product.variants as AdminRecord[] : []
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true)
    setError('')
    try {
      await api(`/api/v1/admin/products/${selectedProduct}/variants/${form.get('variantId')}/stock`, {
        method: 'POST',
        body: JSON.stringify({ delta: Number(form.get('delta')), note: form.get('note') }),
      })
      formElement.reset()
      await onDone()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Stock adjustment failed.')
    } finally {
      setBusy(false)
    }
  }
  return <form className="admin-create-form" onSubmit={(event) => void submit(event)}><h2>Adjust stock</h2>
    {productsQuery.isError && <p className="admin-error">{productsQuery.error.message}</p>}
    <label>Product<select required value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)}><option value="">Select product</option>{products.map((entry) => <option key={String(entry.id)} value={String(entry.id)}>{pretty(entry.name)}</option>)}</select></label>
    <label>Size / variant<select name="variantId" required defaultValue=""><option value="" disabled>Select variant</option>{variants.map((variant) => <option key={String(variant.id)} value={String(variant.id)}>{pretty(variant.size)} · {pretty(variant.sku)} · current {pretty(variant.stock)}</option>)}</select></label>
    <label>Quantity change<input name="delta" type="number" required min="-100000" max="100000" step="1" placeholder="Positive to restock; negative to remove" /></label>
    <label>Reason<input name="note" maxLength={500} required placeholder="Purchase receipt, correction, damaged item…" /></label>
    {error && <p className="admin-error" role="alert">{error}</p>}<button className="button button-green" disabled={busy || !selectedProduct}>{busy ? 'Updating…' : 'Update inventory'} <ArrowRight size={15} /></button>
  </form>
}

type AdminNotification = {
  id: number
  type: 'order' | 'support' | 'announcement'
  title: string
  body: string
  href: string | null
  audienceType: 'all' | 'customer' | 'system'
  audienceUserId: number | null
  createdAt: string
  recipientCount: number
  unreadCount: number | null
}
type NotificationCustomer = { id: number; fullName: string; email: string }

function AdminNotificationsManager() {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [audience, setAudience] = useState<'all' | 'customer'>('all')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const notificationsQuery = useQuery({
    queryKey: ['admin', 'notifications'],
    queryFn: () => api<AdminNotification[]>('/api/v1/admin/notifications'),
  })
  const customersQuery = useQuery({
    queryKey: ['admin', 'notification-customers'],
    queryFn: () => api<NotificationCustomer[]>('/api/v1/admin/customers'),
    enabled: audience === 'customer',
  })

  async function sendNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api<{ id: number; recipientCount: number }>('/api/v1/admin/notifications', {
        method: 'POST',
        body: JSON.stringify({
          title: values.get('title'),
          body: values.get('body'),
          href: values.get('href') || undefined,
          audience,
          ...(audience === 'customer' ? { customerId: Number(values.get('customerId')) } : {}),
        }),
      })
      form.reset()
      setAudience('all')
      setNotice(`Notification sent to ${result.recipientCount} ${result.recipientCount === 1 ? 'customer' : 'customers'}.`)
      await queryClient.invalidateQueries({ queryKey: ['admin', 'notifications'] })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Notification could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  async function retractNotification(notification: AdminNotification) {
    if (!window.confirm(`Retract “${notification.title}” from customer inboxes?`)) return
    setError('')
    try {
      await api(`/api/v1/admin/notifications/${notification.id}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'notifications'] })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Notification could not be retracted.')
    }
  }

  return <div className="admin-notifications-manager">
    <form className="admin-notification-form" onSubmit={(event) => void sendNotification(event)}>
      <div className="admin-notification-heading"><div><span className="admin-kicker">CUSTOMER INBOX</span><h2>Send a notification</h2></div><Bell size={20} /></div>
      <label>Audience<select value={audience} onChange={(event) => setAudience(event.target.value as 'all' | 'customer')}><option value="all">All customers</option><option value="customer">One customer</option></select></label>
      {audience === 'customer' && <label>Customer<select name="customerId" required defaultValue=""><option value="" disabled>Select customer</option>{(customersQuery.data ?? []).map((customer) => <option key={customer.id} value={customer.id}>{customer.fullName} · {customer.email}</option>)}</select>{customersQuery.isError && <span className="admin-form-note">Customer list unavailable: {customersQuery.error.message}</span>}</label>}
      <label>Title<input name="title" required minLength={2} maxLength={160} placeholder="A clear, short heading" /></label>
      <label>Message<textarea name="body" required minLength={2} maxLength={2000} rows={4} placeholder="Write the update customers will see in their inbox." /></label>
      <label>In-app link (optional)<input name="href" maxLength={320} placeholder="/account/orders" /></label>
      {error && <p className="admin-error" role="alert">{error}</p>}{notice && <p className="admin-form-note" role="status">{notice}</p>}
      <button className="button button-green" type="submit" disabled={busy || (audience === 'customer' && customersQuery.isPending)}>{busy ? 'Sending…' : 'Send notification'} <Send size={15} /></button>
    </form>
    <section className="admin-notification-history">
      <div className="admin-notification-heading"><div><span className="admin-kicker">RECENT ACTIVITY</span><h2>Notification history</h2></div><button className="admin-icon-action" type="button" title="Refresh notifications" aria-label="Refresh notifications" onClick={() => void notificationsQuery.refetch()}><ArrowRight size={15} /></button></div>
      {notificationsQuery.isPending ? <div className="admin-empty">Loading notifications…</div>
        : notificationsQuery.isError ? <div className="admin-empty admin-error">{notificationsQuery.error.message}<button type="button" onClick={() => void notificationsQuery.refetch()}>Retry</button></div>
          : notificationsQuery.data?.length ? <div className="admin-notification-list">{notificationsQuery.data.map((notification) => {
            const customer = customersQuery.data?.find((entry) => entry.id === notification.audienceUserId)
            const audienceLabel = notification.audienceType === 'all' ? `${notification.recipientCount} customers`
              : notification.audienceType === 'customer' ? customer?.fullName ?? 'One customer' : notification.type === 'support' ? 'Support event' : 'Order event'
            return <article key={notification.id}>
              <div className="admin-notification-copy"><div><span className="admin-kicker">{notification.type === 'order' ? 'ORDER UPDATE' : notification.type === 'support' ? 'SUPPORT UPDATE' : 'ANNOUNCEMENT'} · {audienceLabel}</span><h3>{notification.title}</h3></div><time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString('en-KE')}</time></div>
              <p>{notification.body}</p><small>{notification.recipientCount} delivered · {notification.unreadCount ?? 0} unread{notification.href ? ` · ${notification.href}` : ''}</small>
              {notification.type === 'announcement' && <button type="button" className="admin-icon-action is-danger" onClick={() => void retractNotification(notification)}><Trash2 size={14} /> Retract</button>}
            </article>
          })}</div>
            : <div className="admin-empty">No notifications have been sent yet.</div>}
    </section>
  </div>
}

type GuestAdminOrder = AdminRecord & {
  id: number
  orderNumber: string
  status: string
  paymentMethod: string
  total: string
  subtotal: string
  deliveryFee: string
  createdAt: string
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
  address: string | null
  town: string | null
  county: string | null
  estate: string | null
  landmark: string | null
  deliveryZone: string | null
  payment: {
    status: string
    amount: string
    providerReceipt: string | null
    payerPhone: string | null
    transactionAt: string | null
    verificationMessage: string | null
  } | null
  items: { name: string; size: string; quantity: number; unitPrice: string }[]
}

function GuestOrdersManager({ orders, onUpdate }: { orders: GuestAdminOrder[]; onUpdate: (order: GuestAdminOrder, status: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'paid' | 'pending'>('all')
  const paidCount = orders.filter((order) => order.payment?.status === 'succeeded').length
  const visibleOrders = orders.filter((order) => filter === 'all'
    || (filter === 'paid' ? order.payment?.status === 'succeeded' : order.payment?.status !== 'succeeded'))
  return <section className="admin-guest-orders">
    <header className="admin-guest-orders-heading"><div><span className="admin-kicker">PUBLIC CHECKOUT</span><h2>Guest orders</h2><p>{orders.length} orders · {paidCount} payments verified</p></div><div className="admin-guest-order-filters" role="group" aria-label="Filter guest orders">
      {(['all', 'paid', 'pending'] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'paid' ? `Paid · ${paidCount}` : 'Awaiting payment'}</button>)}
    </div></header>
    {!visibleOrders.length ? <div className="admin-empty">{filter === 'paid' ? 'No guest payments have been verified yet.' : filter === 'pending' ? 'No guest orders are awaiting payment.' : 'No guest orders have been placed yet.'}</div>
      : <div className="admin-guest-order-list">{visibleOrders.map((order) => {
        const nextStatuses = order.status === 'pending_payment' ? ['cancelled']
          : order.status === 'paid' ? ['processing']
            : order.status === 'processing' ? ['dispatched']
              : order.status === 'dispatched' ? ['delivered'] : []
        const paymentStatus = order.payment?.status ?? 'not_started'
        return <article className="admin-guest-order" key={order.id}>
          <header><div><span className="admin-kicker">GUEST ORDER</span><h3>{order.orderNumber}</h3><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString('en-KE')}</time></div><div className="admin-guest-order-badges"><span className={`admin-status-badge status-${order.status}`}>{order.status.replaceAll('_', ' ')}</span><span className={`admin-status-badge payment-${paymentStatus}`}>{paymentStatus === 'succeeded' ? 'payment verified' : paymentStatus.replaceAll('_', ' ')}</span></div></header>
          <div className="admin-guest-order-details">
            <section><h4>Guest</h4><strong>{order.customerName || 'Name unavailable'}</strong><span>{order.customerEmail || 'Email unavailable'}</span><span>{order.customerPhone || 'Phone unavailable'}</span></section>
            <section><h4>Delivery</h4><span>{[order.address, order.estate, order.landmark].filter(Boolean).join(' · ') || 'Address unavailable'}</span><span>{[order.town, order.county].filter(Boolean).join(', ')}</span><span>{order.deliveryZone || 'Delivery area unavailable'}</span></section>
            <section className="admin-guest-order-payment"><h4>M-PESA</h4><span>Prompt: {order.payment?.payerPhone || 'Not sent'}</span><span>Receipt: {order.payment?.providerReceipt || 'Awaiting verified payment'}</span><span>{order.payment?.transactionAt ? new Date(order.payment.transactionAt).toLocaleString('en-KE') : order.payment?.verificationMessage || 'No payment confirmation yet'}</span></section>
          </div>
          <div className="admin-guest-order-items"><h4>Items</h4>{order.items.map((item, index) => <div key={`${item.name}-${item.size}-${index}`}><span>{item.name} · {item.size} × {item.quantity}</span><strong>KES {(Number(item.unitPrice) * item.quantity).toLocaleString('en-KE')}</strong></div>)}<div className="admin-guest-order-total"><span>Subtotal · {Number(order.subtotal).toLocaleString('en-KE')} + delivery · {Number(order.deliveryFee).toLocaleString('en-KE')}</span><strong>KES {Number(order.total).toLocaleString('en-KE')}</strong></div></div>
          <div className="admin-guest-order-update"><span>Order status: <strong>{order.status.replaceAll('_', ' ')}</strong></span><label>Update status<select aria-label={`Update ${order.orderNumber} status`} defaultValue="" disabled={!nextStatuses.length} onChange={(event) => { if (event.target.value) onUpdate(order, event.target.value) }}><option value="" disabled>{nextStatuses.length ? 'Choose status' : 'No further updates'}</option>{nextStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label></div>
        </article>
      })}</div>}
  </section>
}

const itRoleOptions: { value: ItAccessRole; label: string }[] = [
  { value: 'security_analyst', label: 'Security analyst' },
  { value: 'it_support', label: 'IT support' },
  { value: 'database_admin', label: 'Database administrator' },
  { value: 'infrastructure_admin', label: 'Infrastructure administrator' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'super_admin', label: 'IT super-admin' },
]

function itLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function itDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

function itBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable'
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ItIncidentPanel() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const incidentsQuery = useInfiniteQuery({
    queryKey: ['admin', 'it-incidents'],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '25' })
      if (pageParam) query.set('cursor', String(pageParam))
      return apiPage<ItIncident[]>(`/api/v1/admin/it/incidents?${query}`)
    },
    getNextPageParam: (page) => page.pagination?.hasMore ? page.pagination.nextCursor ?? undefined : undefined,
    retry: false,
  })
  const administratorsQuery = useQuery({
    queryKey: ['admin', 'it-administrators'],
    queryFn: () => api<{ id: number; fullName: string; email: string }[]>('/api/v1/admin/it/administrators'),
    retry: false,
  })
  const incidents = incidentsQuery.data?.pages.flatMap((page) => page.data) ?? []
  const selected = incidents.find((incident) => incident.id === selectedId)
  const eventsQuery = useQuery({
    queryKey: ['admin', 'it-incident-events', selectedId],
    queryFn: () => api<ItIncidentEvent[]>(`/api/v1/admin/it/incidents/${selectedId}/events`),
    enabled: selectedId !== null,
    retry: false,
  })

  async function createIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    setBusy(true)
    try {
      const created = await api<{ id: number }>('/api/v1/admin/it/incidents', {
        method: 'POST',
        body: JSON.stringify({
          severity: form.get('severity'),
          affectedComponent: form.get('affectedComponent'),
          title: form.get('title'),
          description: form.get('description'),
        }),
      })
      event.currentTarget.reset()
      setSelectedId(created.id)
      await queryClient.invalidateQueries({ queryKey: ['admin', 'it-incidents'] })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'it-overview'] })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Incident could not be created.')
    } finally {
      setBusy(false)
    }
  }

  async function updateIncident(incident: ItIncident, patch: Record<string, unknown>) {
    setError('')
    try {
      await api(`/api/v1/admin/it/incidents/${incident.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'it-incidents'] })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'it-incident-events', incident.id] })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'it-overview'] })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Incident could not be updated.')
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedId === null) return
    const form = new FormData(event.currentTarget)
    const message = String(form.get('message') ?? '').trim()
    if (!message) return
    try {
      await api(`/api/v1/admin/it/incidents/${selectedId}/events`, { method: 'POST', body: JSON.stringify({ message }) })
      event.currentTarget.reset()
      await queryClient.invalidateQueries({ queryKey: ['admin', 'it-incident-events', selectedId] })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Incident note could not be saved.')
    }
  }

  async function saveResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const form = new FormData(event.currentTarget)
    await updateIncident(selected, {
      rootCause: String(form.get('rootCause') ?? '').trim() || null,
      resolutionNotes: String(form.get('resolutionNotes') ?? '').trim() || null,
    })
  }

  return <div className="admin-it-incident-layout">
    <section className="admin-it-panel"><header><AlertTriangle size={18} /><div><span className="admin-kicker">INCIDENT REGISTER</span><h3>IT incidents</h3></div></header>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {incidentsQuery.isPending ? <div className="admin-empty">Loading incidents…</div> : incidentsQuery.isError ? <div className="admin-empty admin-error">{incidentsQuery.error.message}</div> : incidents.map((incident) => <button className={`admin-it-incident-row${selectedId === incident.id ? ' is-selected' : ''}`} key={incident.id} type="button" onClick={() => setSelectedId(incident.id)}><strong>{incident.severity}</strong><span><b>{incident.title}</b><small>{incident.incidentNumber} · {itLabel(incident.status)} · {itLabel(incident.affectedComponent)}</small></span><ArrowRight size={14} /></button>)}
      {incidentsQuery.hasNextPage && <button className="admin-it-button" type="button" onClick={() => void incidentsQuery.fetchNextPage()} disabled={incidentsQuery.isFetchingNextPage}>{incidentsQuery.isFetchingNextPage ? 'Loading…' : 'Load more incidents'}</button>}
      <form className="admin-it-create-form" onSubmit={(event) => void createIncident(event)}><h4>Report an incident</h4><div className="admin-it-form-row"><label>Severity<select name="severity" defaultValue="P3"><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select></label><label>Component<select name="affectedComponent" defaultValue="api"><option value="website">Website</option><option value="api">API</option><option value="database">Database</option><option value="payments">Payments</option><option value="email">Email</option><option value="security">Security</option><option value="other">Other</option></select></label></div><label>Title<input name="title" minLength={4} maxLength={160} required /></label><label>Description<textarea name="description" minLength={10} maxLength={4000} rows={3} required /></label><button className="admin-it-button" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create incident'}</button></form>
    </section>
    <section className="admin-it-panel admin-it-incident-detail"><header><Shield size={18} /><div><span className="admin-kicker">INCIDENT TIMELINE</span><h3>{selected?.incidentNumber ?? 'Select an incident'}</h3></div></header>{selected ? <><h4>{selected.title}</h4><p>{selected.description}</p><div className="admin-it-form-row"><label>Status<select value={selected.status} onChange={(event) => void updateIncident(selected, { status: event.target.value })}><option value="open">Open</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label><label>Severity<select value={selected.severity} onChange={(event) => void updateIncident(selected, { severity: event.target.value })}><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select></label></div><label className="admin-it-field">Assign administrator<select value={selected.assignedAdminUserId ?? ''} disabled={administratorsQuery.isPending || administratorsQuery.isError} onChange={(event) => void updateIncident(selected, { assignedAdminUserId: event.target.value ? Number(event.target.value) : null })}><option value="">Unassigned</option>{administratorsQuery.data?.map((admin) => <option key={admin.id} value={admin.id}>{admin.fullName}</option>)}</select></label><form className="admin-it-create-form" onSubmit={(event) => void saveResolution(event)}><label>Root cause<textarea key={`it-cause-${selected.id}`} name="rootCause" defaultValue={selected.rootCause ?? ''} maxLength={4000} rows={2} /></label><label>Resolution notes<textarea key={`it-resolution-${selected.id}`} name="resolutionNotes" defaultValue={selected.resolutionNotes ?? ''} maxLength={4000} rows={2} /></label><button className="admin-it-button" type="submit">Save resolution</button></form><form className="admin-it-create-form" onSubmit={(event) => void addNote(event)}><label>Add timeline note<textarea name="message" minLength={1} maxLength={4000} rows={2} required /></label><button className="admin-it-button" type="submit">Add note</button></form><div className="admin-it-timeline">{eventsQuery.isPending ? <p>Loading incident history…</p> : eventsQuery.isError ? <p>{eventsQuery.error.message}</p> : eventsQuery.data?.map((entry) => <article key={entry.id}><strong>{itLabel(entry.eventType)}</strong><small>{entry.actorName ?? 'System'} · {new Date(entry.createdAt).toLocaleString()}</small><p>{entry.message}</p></article>)}</div></> : <p>Select an incident to inspect its history and response state.</p>}</section>
  </div>
}

function ItAuditPanel() {
  const auditQuery = useInfiniteQuery({
    queryKey: ['admin', 'it-audit'],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '25' })
      if (pageParam) query.set('cursor', String(pageParam))
      return apiPage<ItAuditEntry[]>(`/api/v1/admin/it/audit?${query}`)
    },
    getNextPageParam: (page) => page.pagination?.hasMore ? page.pagination.nextCursor ?? undefined : undefined,
    retry: false,
  })
  const rows = auditQuery.data?.pages.flatMap((page) => page.data) ?? []
  return <section className="admin-it-panel"><header><Shield size={18} /><div><span className="admin-kicker">APPEND-ONLY OPERATIONS HISTORY</span><h3>IT audit events</h3></div></header>{auditQuery.isPending ? <div className="admin-empty">Loading audit events…</div> : auditQuery.isError ? <div className="admin-empty admin-error">{auditQuery.error.message}</div> : <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>{rows.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.actorName ?? itLabel(entry.actorType)}</td><td>{itLabel(entry.action)}</td><td>{entry.targetType} · {entry.targetId}</td><td>{entry.details ?? '—'}</td></tr>)}{!rows.length && <tr><td colSpan={5}>No IT audit events are recorded yet.</td></tr>}</tbody></table></div>}{auditQuery.hasNextPage && <button className="admin-it-button" type="button" onClick={() => void auditQuery.fetchNextPage()} disabled={auditQuery.isFetchingNextPage}>{auditQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}</section>
}

function ItLineChart({ title, points, color, suffix }: { title: string; points: ItChartPoint[]; color: string; suffix?: string }) {
  const maximum = Math.max(1, ...points.map((point) => point.value))
  const coordinates = points.map((point, index) => ({
    x: points.length < 2 ? 370 : 32 + (index * 676) / (points.length - 1),
    y: 154 - (point.value / maximum) * 126,
  }))
  const path = coordinates.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ')

  return <article className="admin-it-chart-card">
    <header><div><span className="admin-kicker">LAST 60 MINUTES · 5-MINUTE BUCKETS</span><h3>{title}</h3></div><strong>{points.at(-1)?.value ?? '—'}{points.length ? suffix : ''}</strong></header>
    {points.length ? <>
      <svg className="admin-it-line-chart" viewBox="0 0 740 190" role="img" aria-label={`${title} over the last 60 minutes`}>
        {[28, 70, 112, 154].map((y) => <line key={y} x1="32" x2="708" y1={y} y2={y} className="admin-it-chart-gridline" />)}
        <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {coordinates.map(({ x, y }, index) => <circle key={`${points[index].label}-${index}`} cx={x} cy={y} r="3" fill={color}><title>{points[index].label}: {points[index].value}{suffix}</title></circle>)}
      </svg>
      <div className="admin-it-chart-labels"><span>{points[0].label}</span><span>{points[Math.floor((points.length - 1) / 2)].label}</span><span>{points.at(-1)?.label}</span></div>
    </> : <div className="admin-it-chart-empty">No request samples in this window.</div>}
  </article>
}

function ItResponseDonut({ distribution }: { distribution: ItOverviewData['requests']['responseDistribution'] }) {
  const total = distribution.success + distribution.redirect + distribution.clientError + distribution.serverError
  const sections = [
    { label: '2xx', value: distribution.success, color: '#62c89a' },
    { label: '3xx', value: distribution.redirect, color: '#70b5f5' },
    { label: '4xx', value: distribution.clientError, color: '#f1bf63' },
    { label: '5xx', value: distribution.serverError, color: '#ef7777' },
  ]
  let accumulated = 0
  const stops = sections.map((section) => {
    const start = total ? (accumulated / total) * 100 : 0
    accumulated += section.value
    const end = total ? (accumulated / total) * 100 : 0
    return `${section.color} ${start}% ${end}%`
  })

  return <article className="admin-it-chart-card admin-it-donut-card">
    <header><div><span className="admin-kicker">LAST 60 MINUTES</span><h3>HTTP response mix</h3></div><strong>{total || '—'}<small> responses</small></strong></header>
    <div className="admin-it-donut-layout">
      <div className={`admin-it-donut${total ? '' : ' is-empty'}`} style={{ background: total ? `conic-gradient(${stops.join(', ')})` : undefined }} role="img" aria-label={total ? `Response codes across ${total} application requests` : 'No response codes recorded'}><span>{total || '—'}</span></div>
      <ul className="admin-it-chart-legend">{sections.map((section) => <li key={section.label}><i style={{ backgroundColor: section.color }} /><span>{section.label}</span><strong>{total ? section.value : '—'}</strong></li>)}</ul>
    </div>
  </article>
}

function ItMethodBars({ methods }: { methods: ItOverviewData['requests']['methods'] }) {
  const maximum = Math.max(1, ...methods.map((method) => method.requests))
  return <article className="admin-it-chart-card admin-it-method-chart">
    <header><div><span className="admin-kicker">APPLICATION REQUESTS</span><h3>Traffic by method</h3></div><strong>{methods.length || '—'} methods</strong></header>
    {methods.length ? <div className="admin-it-endpoint-bars">{methods.map((method) => <div key={method.method} className="admin-it-endpoint-bar-row"><span>{method.method}</span><div><i style={{ width: `${Math.max(3, (method.requests / maximum) * 100)}%` }} /></div><strong>{method.requests}</strong></div>)}</div> : <div className="admin-it-chart-empty">No request samples in this window.</div>}
  </article>
}

function ItOperationsPanel() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'overview' | 'incidents' | 'audit'>('overview')
  const [accessError, setAccessError] = useState('')
  const [accessBusy, setAccessBusy] = useState(false)
  const overviewQuery = useQuery({
    queryKey: ['admin', 'it-overview'],
    queryFn: () => api<ItOverviewData>('/api/v1/admin/it/overview'),
    retry: false,
    refetchInterval: 30_000,
  })
  const role = overviewQuery.data?.access.role
  const accessQuery = useQuery({
    queryKey: ['admin', 'it-access-grants'],
    queryFn: () => api<ItAccessGrant[]>('/api/v1/admin/it/access'),
    enabled: role === 'super_admin',
    retry: false,
  })

  async function changeAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAccessError('')
    setAccessBusy(true)
    const form = new FormData(event.currentTarget)
    try {
      await api('/api/v1/admin/it/access', {
        method: 'POST',
        body: JSON.stringify({ action: 'grant', email: form.get('email'), role: form.get('role') }),
      })
      event.currentTarget.reset()
      await queryClient.invalidateQueries({ queryKey: ['admin', 'it-access-grants'] })
    } catch (issue) {
      setAccessError(issue instanceof Error ? issue.message : 'IT access could not be granted.')
    } finally {
      setAccessBusy(false)
    }
  }

  async function revokeAccess(grant: ItAccessGrant) {
    setAccessError('')
    setAccessBusy(true)
    try {
      await api('/api/v1/admin/it/access', { method: 'POST', body: JSON.stringify({ action: 'revoke', email: grant.email }) })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'it-access-grants'] })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'it-overview'] })
    } catch (issue) {
      setAccessError(issue instanceof Error ? issue.message : 'IT access could not be revoked.')
    } finally {
      setAccessBusy(false)
    }
  }

  if (overviewQuery.isPending) return <div className="admin-empty" role="status">Checking IT access…</div>
  if (overviewQuery.error instanceof AdminApiError && overviewQuery.error.code === 'IT_PERMISSION_REQUIRED') {
    return <section className="admin-it-panel"><header><Shield size={20} /><div><span className="admin-kicker">RESTRICTED IT OPERATIONS</span><h2>IT access is not assigned</h2></div></header><p>Your administrator account has not been granted an IT role. Access is explicitly assigned by an IT super-admin.</p></section>
  }
  if (overviewQuery.isError || !overviewQuery.data) {
    return <section className="admin-it-panel"><header><AlertTriangle size={20} /><div><span className="admin-kicker">IT OPERATIONS</span><h2>Operations data unavailable</h2></div></header><p>{overviewQuery.error instanceof Error ? overviewQuery.error.message : 'Retry the request or contact the system administrator.'}</p><button className="admin-it-button" type="button" onClick={() => void overviewQuery.refetch()}>Retry</button></section>
  }

  const overview = overviewQuery.data
  const superAdmin = role === 'super_admin'
  const availability = (status: string) => status === 'healthy' ? 'Healthy' : status === 'unavailable' ? 'Unavailable' : 'Unknown'
  const requestPoints = overview.requests.timeline.map((bucket) => ({
    label: new Date(bucket.bucketStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    value: bucket.requestCount,
    detail: `${bucket.errorCount} errors`,
  }))
  const latencyPoints = overview.requests.timeline.flatMap((bucket) => bucket.averageResponseMs === null ? [] : [{
    label: new Date(bucket.bucketStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    value: bucket.averageResponseMs,
    detail: 'average milliseconds',
  }])
  const securityPoints = overview.requests.timeline.map((bucket) => ({
    label: new Date(bucket.bucketStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    value: bucket.securitySignalCount,
    detail: '401, 403, and 429 responses',
  }))
  const topEndpoints = overview.requests.endpoints.slice(0, 8)
  const requestRiskScore = overview.requests.requestCount
    ? Number((10 * overview.requests.securitySignalCount / overview.requests.requestCount).toFixed(1))
    : null

  return <div className="admin-it-page">
    <div className="admin-it-intro"><div><span className="admin-kicker">RESTRICTED OPERATIONS · {itLabel(role ?? '')}</span><h2>IT operations</h2><p>Live process and database signals. Provider feeds and historical monitoring are shown only when configured.</p></div><button className="admin-it-button" type="button" onClick={() => void overviewQuery.refetch()} disabled={overviewQuery.isFetching}>Refresh</button></div>
    <nav className="admin-it-tabs" aria-label="IT operations views">{(['overview', 'incidents', 'audit'] as const).map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'is-active' : ''} aria-current={activeTab === tab ? 'page' : undefined} onClick={() => setActiveTab(tab)}>{itLabel(tab)}</button>)}</nav>

    {activeTab === 'overview' ? <>
    <section className="admin-it-status-grid" aria-label="Current system health">
      <article><span>Application process</span><strong><Activity size={16} /> {availability(overview.application.status)}</strong><small>Uptime {itDuration(overview.application.uptimeSeconds)} · Node {overview.application.nodeVersion}</small></article>
      {overview.databases.map((database) => <article key={database.name}><span>{itLabel(database.name)} database</span><strong>{database.status === 'healthy' ? <Check size={16} /> : <AlertTriangle size={16} />}{availability(database.status)}</strong><small>{database.latencyMs === null ? 'Latency unavailable' : `${database.latencyMs} ms read-only probe`}</small></article>)}
      <article><span>Process memory</span><strong><Activity size={16} /> {itBytes(overview.application.memoryRssBytes)}</strong><small>Heap {itBytes(overview.application.heapUsedBytes)}</small></article>
      <article><span>Incidents</span><strong><AlertTriangle size={16} /> {overview.incidents.status === 'available' ? String(overview.incidents.open ?? 0) : 'Unavailable'}</strong><small>{overview.incidents.status === 'available' ? `${overview.incidents.investigating ?? 0} investigating · ${overview.incidents.total ?? 0} total` : 'Incident totals unavailable'}</small></article>
    </section>

    <section className="admin-it-panel"><header><Activity size={18} /><div><span className="admin-kicker">LIVE APPLICATION TELEMETRY · REFRESHES EVERY 30 SECONDS</span><h3>Traffic and performance</h3></div></header>
      <div className="admin-it-metrics"><article><span>Requests last minute</span><strong>{overview.requests.requestsLastMinute}</strong></article><article><span>HTTP errors</span><strong>{overview.requests.errorCount}</strong></article><article><span>2xx success</span><strong>{overview.requests.successfulRequestCount}</strong></article><article><span>Average response</span><strong>{overview.requests.averageResponseMs === null ? 'Unavailable' : `${overview.requests.averageResponseMs} ms`}</strong></article><article><span>P95 response</span><strong>{overview.requests.p95ResponseMs === null ? 'Unavailable' : `${overview.requests.p95ResponseMs} ms`}</strong></article></div>
      <div className="admin-it-risk-meter"><div><span>Request security-signal index</span><strong>{requestRiskScore === null ? 'Unavailable' : `${requestRiskScore}/10`}</strong></div><meter min="0" max="10" value={requestRiskScore ?? 0} /><small>Heuristic from the share of 401, 403, and 429 responses in this sample. It is not a confirmed threat level or security alert.</small></div>
      <div className="admin-it-chart-grid">
        <ItLineChart title="Requests per 5 minutes" points={requestPoints} color="#73c7ff" />
        <ItLineChart title="Average response time" points={latencyPoints} color="#f0bd62" suffix=" ms" />
        <ItLineChart title="Authentication and rate-limit signals" points={securityPoints} color="#ed7b7b" />
        <ItResponseDonut distribution={overview.requests.responseDistribution} />
        <ItMethodBars methods={overview.requests.methods} />
      </div>
      <section className="admin-it-chart-card admin-it-endpoint-chart"><header><div><span className="admin-kicker">ROUTE TEMPLATE · TOP 8</span><h3>Requests by endpoint</h3></div><strong>{overview.requests.endpoints.length || '—'} routes</strong></header>
        {topEndpoints.length ? <div className="admin-it-endpoint-bars">{topEndpoints.map((endpoint) => <div key={endpoint.endpoint} className="admin-it-endpoint-bar-row"><span title={endpoint.endpoint}>{endpoint.endpoint}</span><div><i style={{ width: `${Math.max(3, (endpoint.requests / Math.max(topEndpoints[0].requests, 1)) * 100)}%` }} /></div><strong>{endpoint.requests}</strong></div>)}</div> : <div className="admin-it-chart-empty">No request samples in this window.</div>}
      </section>
      <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr><th>Endpoint</th><th>Requests</th><th>Errors</th><th>Average</th></tr></thead><tbody>{overview.requests.endpoints.map((metric) => <tr key={metric.endpoint}><td>{metric.endpoint}</td><td>{metric.requests}</td><td>{metric.errors}</td><td>{metric.averageResponseMs} ms</td></tr>)}{!overview.requests.endpoints.length && <tr><td colSpan={4}>No requests sampled yet.</td></tr>}</tbody></table></div><p className="admin-it-footnote">Last collected {new Date(overview.requests.collectedAt).toLocaleTimeString()}. This bounded sample is process-local, resets on restart, and is not shared across instances. Traffic represents requests reaching this application, not edge or network traffic.</p>
    </section>

    <section className="admin-it-panel"><header><Database size={18} /><div><span className="admin-kicker">TELEMETRY COVERAGE</span><h3>Unconfigured monitors</h3></div></header><div className="admin-it-coverage">{Object.entries(overview.coverage).map(([name, item]) => <article key={name}><span>{itLabel(name)}</span><strong><CircleHelp size={15} /> {itLabel(item.status)}</strong></article>)}</div></section>

    <section className="admin-it-panel"><header><CircleHelp size={18} /><div><span className="admin-kicker">EXTERNAL PROVIDERS</span><h3>Provider health</h3></div></header><div className="admin-it-coverage">{Object.entries(overview.externalServices).map(([name, service]) => <article key={name}><span>{itLabel(name)}</span><strong><CircleHelp size={15} /> {itLabel(service.status)}</strong><small>{service.reason}</small></article>)}</div></section>
    </> : activeTab === 'incidents' ? <ItIncidentPanel /> : <ItAuditPanel />}

    {superAdmin && <section className="admin-it-panel"><header><Shield size={18} /><div><span className="admin-kicker">EXPLICIT GRANTS</span><h3>IT access</h3></div></header><p>Only listed, verified administrator accounts have an IT role. Existing administrators receive no access automatically.</p>{accessError && <p className="admin-error" role="alert">{accessError}</p>}
      <form className="admin-it-access-form" onSubmit={(event) => void changeAccess(event)}><label>Verified admin email<input name="email" type="email" required maxLength={254} /></label><label>IT role<select name="role" defaultValue="viewer">{itRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button className="admin-it-button" type="submit" disabled={accessBusy}>Grant access</button></form>
      {accessQuery.isPending ? <div className="admin-empty">Loading explicit grants…</div> : accessQuery.isError ? <div className="admin-empty admin-error">{accessQuery.error.message}</div> : <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr><th>Administrator</th><th>Role</th><th>Granted</th><th>Action</th></tr></thead><tbody>{accessQuery.data?.map((grant) => <tr key={grant.adminUserId}><td>{grant.fullName}<small>{grant.email}</small></td><td>{itLabel(grant.role)}</td><td>{new Date(grant.grantedAt).toLocaleString()}</td><td><button className="admin-it-button is-danger" type="button" disabled={accessBusy} onClick={() => void revokeAccess(grant)}>Revoke</button></td></tr>)}{!accessQuery.data?.length && <tr><td colSpan={4}>No explicit IT grants exist.</td></tr>}</tbody></table></div>}
    </section>}
  </div>
}

export function AdminConsole() {
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const [createdImageProductId, setCreatedImageProductId] = useState<number | undefined>()
  const [imageManagerSelectionKey, setImageManagerSelectionKey] = useState(0)
  const [reportPeriod, setReportPeriod] = useState<'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom'>('last30days')
  const [customFrom, setCustomFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10))
  const current = sections.find(([, , path]) => path === location.pathname) ?? sections[0]
  const endpoint = current[0] === 'dashboard' ? 'dashboard'
    : current[0] === 'football' ? 'catalogue-options'
    : current[0] === 'inventory' ? 'inventory/movements'
      : current[0] === 'delivery' ? 'delivery/zones'
        : current[0] === 'reports' ? 'reports/financial'
          : current[0] === 'audit' ? 'audit' : current[0]
  const sectionQuery = useQuery({
    queryKey: ['admin', endpoint, ...(current[0] === 'dashboard' ? [reportPeriod, customFrom, customTo] : [])],
    queryFn: () => {
      if (current[0] !== 'dashboard') return api<AdminRecord[] | AdminRecord>(`/api/v1/admin/${endpoint}`)
      const query = new URLSearchParams({ period: reportPeriod })
      if (reportPeriod === 'custom') {
        query.set('from', customFrom)
        query.set('to', customTo)
      }
      return api<AdminRecord>(`/api/v1/admin/${endpoint}?${query}`)
    },
    enabled: current[0] !== 'it',
    retry: false,
    refetchInterval: false,
  })

  useEffect(() => {
    if (isAdminSessionExpired(sectionQuery.error)) {
      navigate('/admin/login?reason=expired', { replace: true })
    }
  }, [sectionQuery.error, navigate])

  useEffect(() => {
    const expireSession = () => navigate('/admin/login?reason=expired', { replace: true })
    window.addEventListener(adminSessionExpiredEvent, expireSession)
    return () => window.removeEventListener(adminSessionExpiredEvent, expireSession)
  }, [navigate])

  useEffect(() => {
    const idleTimeoutMs = 15 * 60_000
    const keepAliveThrottleMs = 30_000
    let idleTimer = 0
    let lastKeepAlive = Date.now()
    let signingOut = false
    const leaveAdmin = (reason: 'idle' | 'expired' = 'idle') => {
      if (signingOut) return
      signingOut = true
      void api('/api/v1/admin/logout', { method: 'POST' })
        .catch(() => undefined)
        .finally(() => navigate(`/admin/login?reason=${reason}`, { replace: true }))
    }
    const resetIdleTimer = () => {
      if (signingOut) return
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(leaveAdmin, idleTimeoutMs)
      const now = Date.now()
      if (now - lastKeepAlive < keepAliveThrottleMs) return
      lastKeepAlive = now
      void api('/api/v1/admin/session/activity', { method: 'POST' }).catch((issue: unknown) => {
        if (isAdminSessionExpired(issue)) leaveAdmin('expired')
      })
    }
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']
    events.forEach((eventName) => window.addEventListener(eventName, resetIdleTimer, { passive: true }))
    resetIdleTimer()
    return () => {
      window.clearTimeout(idleTimer)
      events.forEach((eventName) => window.removeEventListener(eventName, resetIdleTimer))
    }
  }, [navigate])

  async function logout() {
    try { await api('/api/v1/admin/logout', { method: 'POST' }) } finally { navigate('/admin/login', { replace: true }) }
  }
  async function patchOrder(order: AdminRecord, status: string) {
    setActionError('')
    try {
      await api(`/api/v1/admin/orders/${encodeURIComponent(String(order.id))}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await sectionQuery.refetch()
    } catch (issue) {
      setActionError(issue instanceof Error ? issue.message : 'Order update failed.')
    }
  }
  const data = sectionQuery.data
  const records = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.entries(data).filter(([, value]) => Array.isArray(value)).flatMap(([, value]) => value as AdminRecord[]) : []
  const dashboardMetrics: [string, string][] = !Array.isArray(data) && data && current[0] === 'dashboard' ? [
    ['Revenue (paid)', `KES ${Number(data.paidRevenue ?? 0).toLocaleString('en-KE')}`],
    ['Paid orders', String(data.paidOrderCount ?? 0)],
    ['Average order value', `KES ${Number(data.averageOrderValue ?? 0).toLocaleString('en-KE')}`],
    ['New customers', String(data.newCustomers ?? 0)],
    ['Returning customers', String(data.returningCustomers ?? 0)],
    ['All customers', String(data.totalCustomers ?? 0)],
    ['All products', String(data.totalProducts ?? 0)],
    ['Pending orders', String(data.pendingOrders ?? 0)],
    ['Low-stock variants', String(data.lowStockVariants ?? 0)],
    ['Out-of-stock variants', String(data.outOfStockVariants ?? 0)],
  ] : []

  return <div className="admin-app">
    <aside className={menuOpen ? 'admin-sidebar is-open' : 'admin-sidebar'}><Link to="/" className="admin-brand"><img src="/culture-mark.webp" alt="" /> KitCulture <span>ADMIN</span></Link><nav aria-label="Admin modules">{sections.map(([id, title, path, Icon]) => <Link key={id} to={path} onClick={() => setMenuOpen(false)} className={current[0] === id ? 'active' : ''}><Icon size={17} />{title}</Link>)}</nav><button className="admin-logout" type="button" onClick={() => void logout()}><LogOut size={17} /> Sign out</button></aside>
    {menuOpen && <button className="admin-nav-scrim" aria-label="Close admin menu" onClick={() => setMenuOpen(false)} />}
    <main className={current[0] === 'products' ? 'admin-main admin-products-page' : current[0] === 'football' ? 'admin-main admin-football-page' : current[0] === 'homepage' ? 'admin-main admin-homepage-page' : current[0] === 'settings' ? 'admin-main admin-settings-page' : 'admin-main'}><header className="admin-topbar"><button type="button" className="admin-menu-toggle" aria-label={menuOpen ? 'Close menu' : 'Open menu'} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button><div><span className="admin-kicker">KITCULTURE OPERATIONS</span><h1>{current[1]}</h1></div><Link to="/" className="admin-store-link">View storefront ↗</Link></header>
      {current[0] === 'dashboard' && <div className="admin-report-toolbar"><label>Reporting period<select value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value as typeof reportPeriod)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="last7days">Last 7 days</option><option value="last30days">Last 30 days</option><option value="thisMonth">This month</option><option value="lastMonth">Last month</option><option value="thisYear">This year</option><option value="custom">Custom range</option></select></label>{reportPeriod === 'custom' && <><label>From<input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>To<input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></>}</div>}
      {current[0] === 'it' ? <ItOperationsPanel /> : sectionQuery.isPending ? <div className="admin-empty">Loading live database records…</div> : sectionQuery.isError ? <div className="admin-empty admin-error"><strong>Admin data unavailable</strong><span>{sectionQuery.error.message}. Confirm the database is configured and your account has the administrator role.</span></div> : <>
        {current[0] === 'dashboard' && <div className="admin-metrics">{dashboardMetrics.map(([key, value]) => <article key={key}><span>{key}</span><strong>{value}</strong></article>)}</div>}
        {current[0] === 'dashboard' && data && !Array.isArray(data) && <AdminDashboardCharts data={data} />}
        {current[0] === 'notifications' || current[0] === 'guest-orders' ? null : current[0] === 'football'
          ? <FootballCatalogueManager onDone={async () => { await sectionQuery.refetch() }} />
          : current[0] === 'inventory'
          ? <InventoryAdjustmentForm onDone={async () => { await sectionQuery.refetch() }} />
          : current[0] === 'homepage'
            ? <HomepageSlidesManager slides={records.filter(isHomepageSlide)} onDone={async () => { await sectionQuery.refetch() }} />
          : <SectionForm section={current[0]} onDone={async (createdProductId) => {
            if (createdProductId) {
              setCreatedImageProductId(createdProductId)
              setImageManagerSelectionKey((key) => key + 1)
            }
            await sectionQuery.refetch()
          }} />}
        {current[0] === 'support' && <SupportRequestsManager requests={records.filter(isAdminSupportRequest)} onDone={async () => { await sectionQuery.refetch() }} />}
        {current[0] === 'notifications' && <AdminNotificationsManager />}
        {current[0] === 'guest-orders' && <GuestOrdersManager orders={records as unknown as GuestAdminOrder[]} onUpdate={(order, status) => void patchOrder(order, status)} />}
        {current[0] === 'products' && <>
          <ProductPublishingManager onDone={async () => { await sectionQuery.refetch() }} />
          <ProductClassificationManager onDone={async () => { await sectionQuery.refetch() }} />
          <ProductImageManager key={imageManagerSelectionKey} initialProductId={createdImageProductId} onDone={async () => { await sectionQuery.refetch() }} />
        </>}
        {current[0] === 'orders' && <OrderPaymentTables orders={records} />}
        {current[0] === 'orders' && <section className="admin-order-actions"><h2>Order status</h2>{records.map((order) => {
          const status = String(order.status)
          const nextStatuses = status === 'pending_payment'
            ? String(order.paymentMethod) === 'pay_on_delivery' ? ['processing', 'cancelled'] : ['cancelled']
            : status === 'paid' ? ['processing']
              : status === 'processing' ? ['dispatched']
                : status === 'dispatched' ? ['delivered'] : []
          const displayOrderNumber = formatAdminOrderNumber(order)
          return <article key={String(order.id)}><span><strong>{displayOrderNumber}</strong> · {pretty(status)}</span><select aria-label={`Update ${displayOrderNumber} status`} defaultValue="" disabled={nextStatuses.length === 0} onChange={(event) => { if (event.target.value) void patchOrder(order, event.target.value) }}><option value="" disabled>{nextStatuses.length ? 'Update status' : 'No further updates'}</option>{nextStatuses.map((nextStatus) => <option key={nextStatus} value={nextStatus}>{pretty(nextStatus)}</option>)}</select></article>
        })}</section>}
        {actionError && <p className="admin-error">{actionError}</p>}
        {!['dashboard', 'it', 'homepage', 'support', 'football', 'notifications', 'guest-orders', 'orders'].includes(current[0]) && <DataTable rows={current[0] === 'products' ? records.map(({ images: _images, variants: _variants, ...record }) => record) : records} empty="No records are available for this section yet." />}
        {current[0] === 'dashboard' && data && !Array.isArray(data) && <section className="admin-dashboard-orders"><div className="admin-analytics-heading"><div><span className="admin-kicker">LATEST ACTIVITY</span><h2>Recent orders</h2></div></div><DataTable rows={Array.isArray(data.recentOrders) ? data.recentOrders as AdminRecord[] : []} empty="No orders have been placed yet." /></section>}
      </>}
    </main>
  </div>
}

export function AdminRoute() {
  const location = useLocation()
  const isAdministratorPortalPath = /^\/admin(?:\/|$)/.test(location.pathname)
  const isAdminPortalRoute = isAdministratorPortalPath
  const isAdminAuthRoute = ['/admin/login', '/admin/register', '/admin/onboarding', '/admin/verify'].includes(location.pathname)
  const sessionQuery = useQuery({
    queryKey: ['admin-session'],
    queryFn: () => api<{ user: { id: number } }>('/api/v1/admin/me'),
    enabled: isAdminPortalRoute && !isAdminAuthRoute,
    retry: false,
  })

  if (location.pathname === '/admin/login') return <AdminLoginPage />
  if (location.pathname === '/admin/register') return <AdminRegisterPage />
  if (location.pathname === '/admin/onboarding') return <AdminOnboardingPage />
  if (location.pathname === '/admin/verify') return <AdminVerifyPage />
  if (isAdminPortalRoute) {
    if (sessionQuery.isPending) return <main className="auth-checking" role="status">Checking administrator session…</main>
    if (sessionQuery.isError) {
      if (isAdminSessionExpired(sessionQuery.error)) return <Navigate to="/admin/login?reason=expired" replace />
      return <main className="auth-checking"><p role="alert">Administrator service unavailable: {sessionQuery.error.message}</p><button type="button" onClick={() => void sessionQuery.refetch()}>Retry</button></main>
    }
    return <AdminConsole />
  }
  return <Navigate to="/admin/login" replace />
}
