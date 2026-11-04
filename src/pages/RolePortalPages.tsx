import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery} from '@tanstack/react-query'
import { AlertTriangle, BarChart3, Boxes, CircleDollarSign, FileText, Megaphone, Package, Receipt, ShoppingBag } from 'lucide-react'
import '../admin-theme.css'
import '../role-portal-theme.css'

const roleConfig = {
  'finance-admin': { role: 'finance_admin', title: 'Finance Operations', modules: ['Dashboard', 'Payments', 'M-Pesa', 'Reconciliation', 'Refunds', 'Revenue', 'Outstanding Payments', 'Expenses', 'Financial Reports', 'Analytics', 'Audit Logs', 'Notifications', 'Settings'], endpoints: { Payments: '/api/v1/admin/payments', Expenses: '/api/v1/admin/expenses', 'Financial Reports': '/api/v1/admin/reports/financial', 'Audit Logs': '/api/v1/admin/audit', Notifications: '/api/v1/admin/notifications' }, icon: CircleDollarSign },
  'inventory-admin': { role: 'inventory_admin', title: 'Inventory and Logistics', modules: ['Overview', 'Stock', 'Movements', 'Fulfilment'], endpoints: { Stock: '/api/v1/admin/products', Movements: '/api/v1/admin/inventory/movements', Fulfilment: '/api/v1/admin/orders' }, icon: Boxes },
  'marketing-admin': { role: 'marketing_admin', title: 'Marketing Operations', modules: ['Overview', 'Campaigns', 'Promotions', 'Notifications'], endpoints: { Campaigns: '/api/v1/admin/notifications', Promotions: '/api/v1/admin/notifications', Notifications: '/api/v1/admin/notifications' }, icon: Megaphone },
  'content-admin': { role: 'content_admin', title: 'Products and Content', modules: ['Overview', 'Products', 'Categories', 'Homepage'], endpoints: { Products: '/api/v1/admin/products', Categories: '/api/v1/admin/categories', Homepage: '/api/v1/admin/homepage' }, icon: Package },
} as const

type PortalData = {
  role: string
  portal: string
  metrics: Record<string, number | string>
  series: { label: string; value: number }[]
  records: Record<string, unknown>[]
}

async function roleApi<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'include' })
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? 'The administrator portal is unavailable.')
  return payload.data as T
}

export function RolePortalLoginPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const prefix = location.pathname.split('/')[1] as keyof typeof roleConfig
  const config = roleConfig[prefix]
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!config) return <main className="admin-empty">Unknown administrator portal.</main>

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/v1/admin/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity, password, expectedRole: config.role }) })
      const payload = await response.json() as { data?: { portal: string }; error?: { message?: string } }
      if (!response.ok) throw new Error(payload.error?.message ?? 'Administrator sign in failed.')
      navigate(payload.data?.portal ?? `/${prefix}/dashboard`, { replace: true })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Administrator sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="role-portal-login"><section className="role-portal-login-card"><Link to="/" className="role-portal-login-brand"><img src="/culture-mark.webp" alt="" /><span>KitCulture</span></Link><span className="admin-kicker">RESTRICTED {prefix.replace('-admin', '').toUpperCase()} ACCESS</span><h1>{config.title}</h1><p>Sign in with the role number or email assigned to this administrator portal.</p><form onSubmit={(event) => void submit(event)}><label>Role number or email<input value={identity} onChange={(event) => setIdentity(event.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p className="admin-error" role="alert">{error}</p>}<button className="role-portal-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : `Sign in to ${config.title}`}</button></form><Link className="role-portal-login-link" to="/admin/login">Existing Sales Admin sign in</Link></section></main>
}

async function signOutRolePortal(navigate: (path: string, options?: { replace?: boolean }) => void, prefix: keyof typeof roleConfig) {
  try {
    await fetch('/api/v1/admin/logout', { method: 'POST', credentials: 'include' })
  } finally {
    navigate(`/${prefix}/login`, { replace: true })
  }
}

function currency(value: number | string) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(value) || 0)
}

type FinanceDashboard = {
  paidRevenue: string
  paidOrderCount: number
  averageOrderValue: string
  paidPayments: number
  pendingOrders: number
  revenueTrend: { date: string; revenue: string }[]
}
type FinanceReport = { grossSales: string; discounts: string; collectedPayments: string; operatingExpenses: string; costOfGoodsSold: string | null; profitAvailable: boolean }

function FinanceUnavailable({ title, detail }: { title: string; detail: string }) {
  return <section className="finance-panel finance-unavailable"><AlertTriangle size={22} /><span className="admin-kicker">CONTROL NOT CONNECTED</span><h2>{title}</h2><p>{detail}</p></section>
}

function FinanceTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <div className="admin-empty">No financial records are available.</div>
  const columns = Object.keys(rows[0]).slice(0, 7)
  return <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/([A-Z])/g, ' $1')}</th>)}</tr></thead><tbody>{rows.slice(0, 40).map((row, index) => <tr key={String(row.id ?? row.orderNumber ?? index)}>{columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? '—' : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column])}</td>)}</tr>)}</tbody></table></div>
}

function FinanceTrend({ points }: { points: { date: string; revenue: string }[] }) {
  if (!points.length) return <div className="admin-empty">No settled revenue has been recorded for this period.</div>
  const maximum = Math.max(1, ...points.map((point) => Number(point.revenue) || 0))
  const coordinates = points.map((point, index) => `${points.length === 1 ? 50 : (index / (points.length - 1)) * 100},${94 - ((Number(point.revenue) || 0) / maximum) * 78}`).join(' ')
  return <div className="finance-trend"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Revenue trend"><polyline points={coordinates} /></svg><div><span>{points[0].date}</span><span>{points.at(-1)?.date}</span></div></div>
}

function FinanceWorkspace({ prefix }: { prefix: keyof typeof roleConfig }) {
  const navigate = useNavigate()
  const [activeModule, setActiveModule] = useState('Dashboard')
  const portal = useQuery({ queryKey: ['finance-portal'], queryFn: () => roleApi<PortalData>('/api/v1/admin/portal/finance_admin'), retry: false })
  const dashboard = useQuery({ queryKey: ['finance-dashboard'], queryFn: () => roleApi<FinanceDashboard>('/api/v1/admin/dashboard?period=last30days'), retry: false })
  const report = useQuery({ queryKey: ['finance-report'], queryFn: () => roleApi<FinanceReport>('/api/v1/admin/reports/financial'), enabled: activeModule === 'Revenue' || activeModule === 'Financial Reports', retry: false })
  const payments = useQuery({ queryKey: ['finance-payments'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/payments'), enabled: activeModule === 'Payments' || activeModule === 'M-Pesa', retry: false })
  const expenses = useQuery({ queryKey: ['finance-expenses'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/expenses'), enabled: activeModule === 'Expenses', retry: false })
  const audit = useQuery({ queryKey: ['finance-audit'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/audit'), enabled: activeModule === 'Audit Logs', retry: false })
  const notifications = useQuery({ queryKey: ['finance-notifications'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/notifications'), enabled: activeModule === 'Notifications', retry: false })
  const config = roleConfig[prefix]
  const data = dashboard.data
  const reportData = report.data
  const metricCards = [
    ['Total revenue', currency(data?.paidRevenue ?? 0)], ['Payments received', String(data?.paidPayments ?? 0)],
    ['Pending payments', String(data?.pendingOrders ?? 0)], ['Outstanding balance', 'Not calculated'],
    ['Refunds', 'Not connected'], ['Net revenue', reportData ? currency(Number(reportData.collectedPayments) - Number(reportData.discounts)) : 'Loading'],
  ]
  const panel = activeModule === 'Dashboard' ? <>
    <div className="finance-kpi-grid">{metricCards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    <div className="finance-panel-grid"><section className="finance-panel"><header><div><span className="admin-kicker">REVENUE TREND · LAST 30 DAYS</span><h2>Settled revenue</h2></div><BarChart3 size={19} /></header><FinanceTrend points={data?.revenueTrend ?? []} /></section><section className="finance-panel"><header><div><span className="admin-kicker">PAYMENT STATUS</span><h2>Transaction distribution</h2></div><Receipt size={19} /></header><div className="finance-bars">{(portal.data?.series ?? []).map((point) => <div key={point.label}><span>{point.label}</span><i><b style={{ width: `${Math.max(4, point.value / Math.max(1, ...(portal.data?.series ?? []).map((item) => item.value)) * 100)}%` }} /></i><strong>{point.value}</strong></div>)}</div></section></div>
    <section className="finance-panel"><header><div><span className="admin-kicker">RECENT FINANCIAL ACTIVITY</span><h2>Latest transactions</h2></div><ShoppingBag size={19} /></header><FinanceTable rows={portal.data?.records ?? []} /></section>
  </> : activeModule === 'Payments' || activeModule === 'M-Pesa' ? <section className="finance-panel"><header><div><span className="admin-kicker">{activeModule === 'M-Pesa' ? 'SAFARICOM DARaja' : 'PAYMENT MANAGEMENT'}</span><h2>{activeModule}</h2></div><Receipt size={19} /></header><p className="finance-panel-copy">Trusted backend payment records only. Customer screenshots and submitted transaction codes are not used as confirmation.</p><FinanceTable rows={payments.data ?? portal.data?.records ?? []} /></section> : activeModule === 'Expenses' ? <section className="finance-panel"><header><div><span className="admin-kicker">OPERATING COSTS</span><h2>Expense management</h2></div><Receipt size={19} /></header><FinanceTable rows={expenses.data ?? []} /></section> : activeModule === 'Revenue' ? <section className="finance-panel"><header><div><span className="admin-kicker">REVENUE MANAGEMENT</span><h2>Revenue and margin view</h2></div><BarChart3 size={19} /></header><div className="finance-report-grid">{Object.entries(reportData ?? {}).filter(([key]) => key !== 'profitAvailable').map(([key, value]) => <article key={key}><span>{key.replace(/([A-Z])/g, ' $1')}</span><strong>{key === 'costOfGoodsSold' && value === null ? 'Unavailable' : currency(String(value))}</strong></article>)}</div><p className="finance-panel-copy">Profit is shown only when product cost data is available.</p></section> : activeModule === 'Financial Reports' ? <section className="finance-panel"><header><div><span className="admin-kicker">REPORTING CENTRE</span><h2>Financial reports</h2></div><FileText size={19} /></header><div className="finance-report-grid">{Object.entries(reportData ?? {}).map(([key, value]) => <article key={key}><span>{key.replace(/([A-Z])/g, ' $1')}</span><strong>{typeof value === 'boolean' ? value ? 'Available' : 'Unavailable' : currency(String(value))}</strong></article>)}</div><p className="finance-panel-copy">CSV, Excel, and PDF exports require a reviewed export endpoint and are not enabled yet.</p></section> : activeModule === 'Audit Logs' ? <section className="finance-panel"><header><div><span className="admin-kicker">FINANCIAL ACCOUNTABILITY</span><h2>Audit activity</h2></div><FileText size={19} /></header><FinanceTable rows={audit.data ?? []} /></section> : activeModule === 'Notifications' ? <section className="finance-panel"><header><div><span className="admin-kicker">FINANCE NOTIFICATIONS</span><h2>Notification history</h2></div><Receipt size={19} /></header><FinanceTable rows={notifications.data ?? []} /></section> : <FinanceUnavailable title={`${activeModule} is not connected`} detail="This control requires an additive finance workflow, database contract, and audited server mutation before it can be enabled." />
  return <main className="admin-it-page super-admin-page role-portal-shell finance-portal-shell"><aside className="super-admin-sidebar role-portal-sidebar"><Link to="/" className="admin-brand"><img src="/culture-mark.webp" alt="" /> KitCulture</Link><strong>{config.title}</strong><nav>{config.modules.map((module) => <button type="button" key={module} className={activeModule === module ? 'active' : ''} onClick={() => setActiveModule(module)}>{module}</button>)}</nav><button type="button" className="admin-it-button role-portal-signout" onClick={() => void signOutRolePortal(navigate, prefix)}>Sign out</button></aside><section className="super-admin-main role-portal-main finance-portal-main"><header><div><span className="admin-kicker">FINANCIAL MANAGEMENT AND CONTROL</span><h1>{activeModule}</h1><p className="finance-header-copy">Revenue, payments, accountability, and financial control for KitCulture.</p></div><CircleDollarSign size={24} /></header>{portal.isError || dashboard.isError ? <div className="admin-empty admin-error">Finance data is unavailable: {(portal.error ?? dashboard.error)?.message}</div> : panel}</section></main>
}

export function RolePortalRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const prefix = location.pathname.split('/')[1] as keyof typeof roleConfig
  const isLoginRoute = location.pathname.endsWith('/login')
  const session = useQuery({
    queryKey: ['role-portal-session', prefix],
    queryFn: () => roleApi<{ user: { role: string | null } }>('/api/v1/admin/me'),
    enabled: Boolean(roleConfig[prefix]) && !isLoginRoute,
    retry: false,
  })
  useEffect(() => {
    if (session.isPending || (!session.isError && session.data?.user.role === roleConfig[prefix].role)) return
    if (session.isError) {
      void navigate(`/${prefix}/login`, { replace: true })
      return
    }
    void signOutRolePortal(navigate, prefix)
  }, [navigate, prefix, session.data?.user.role, session.isError, session.isPending])
  if (location.pathname.endsWith('/login')) return <RolePortalLoginPage />
  if (session.isPending) return <main className="role-portal-auth-check" role="status">Verifying administrator access...</main>
  if (session.isError || session.data?.user.role !== roleConfig[prefix].role) {
    return <main className="role-portal-auth-check" role="status">Redirecting to administrator sign in...</main>
  }
  return <RolePortalDashboard />
}

function RolePortalDashboard() {
  const location = useLocation()
  const navigate = useNavigate()
  const prefix = location.pathname.split('/')[1] as keyof typeof roleConfig
  const config = roleConfig[prefix]
  const [activeModule, setActiveModule] = useState<string>(config?.modules[0] ?? 'Overview')
  const portal = useQuery({
    queryKey: ['administrator-portal', prefix],
    queryFn: () => roleApi<PortalData>(`/api/v1/admin/portal/${config.role}`),
    enabled: Boolean(config),
    retry: false,
  })
  const moduleEndpoint = config.endpoints[activeModule as keyof typeof config.endpoints] as string | undefined
  const moduleData = useQuery({
    queryKey: ['administrator-portal-module', prefix, activeModule],
    queryFn: async () => roleApi<unknown[]>(moduleEndpoint ?? ''),
    enabled: Boolean(moduleEndpoint),
    retry: false,
  })

  if (!config) return <main className="admin-empty">Unknown administrator portal.</main>
  if (prefix === 'finance-admin') return <FinanceWorkspace prefix={prefix} />
  const Icon = config.icon
  const metrics = Object.entries(portal.data?.metrics ?? {})
  const maximum = Math.max(1, ...((portal.data?.series ?? []).map((point) => point.value)))

  return <main className="admin-it-page super-admin-page role-portal-shell">
    <aside className="super-admin-sidebar role-portal-sidebar">
      <Link to="/" className="admin-brand"><img src="/culture-mark.webp" alt="" /> KitCulture</Link>
      <strong>{config.title}</strong>
      <nav>{config.modules.map((module) => <button type="button" key={module} className={activeModule === module ? 'active' : ''} onClick={() => setActiveModule(module)}>{module}</button>)}</nav>
      <button type="button" className="admin-it-button role-portal-signout" onClick={() => void signOutRolePortal(navigate, prefix)}>Sign out</button>
    </aside>
    <section className="super-admin-main role-portal-main">
      <header><div><span className="admin-kicker">ROLE-RESTRICTED PORTAL</span><h1>{config.title}</h1></div><Icon size={24} /></header>
      {portal.isPending && <div className="admin-empty">Loading live portal data…</div>}
      {portal.isError && <div className="admin-empty admin-error">{portal.error.message}</div>}
      {portal.data && <>
        <div className="admin-it-stat-grid">
          {metrics.map(([label, value]) => <article key={label}><span>{label.replace(/([A-Z])/g, ' $1')}</span><strong>{label.toLowerCase().includes('revenue') || label.toLowerCase().includes('value') ? currency(value) : String(value)}</strong></article>)}
        </div>
        <section className="admin-it-panel">
          <header><BarChart3 size={18} /><div><span className="admin-kicker">LIVE DATABASE DATA · {activeModule}</span><h3>{activeModule} activity</h3></div></header>
          {portal.data.series.length ? <div className="admin-it-endpoint-bars">{portal.data.series.map((point) => <div className="admin-it-endpoint-bar-row" key={point.label}><span>{point.label}</span><div><i style={{ width: `${Math.max(3, point.value / maximum * 100)}%` }} /></div><strong>{point.value}</strong></div>)}</div> : <div className="admin-empty">No activity is available for this period.</div>}
        </section>
        <section className="admin-it-panel">
          <header><ShoppingBag size={18} /><div><span className="admin-kicker">RECENT RECORDS</span><h3>{activeModule}</h3></div></header>
          {moduleEndpoint && moduleData.isPending && <div className="admin-empty">Loading records…</div>}
          {moduleEndpoint && moduleData.isError && <div className="admin-empty admin-error">{moduleData.error.message}</div>}
          {moduleEndpoint && Array.isArray(moduleData.data) && moduleData.data.length > 0 && <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr>{Object.keys(moduleData.data[0] as Record<string, unknown>).slice(0, 6).map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{moduleData.data.slice(0, 25).map((record, index) => <tr key={index}>{Object.keys(record as Record<string, unknown>).slice(0, 6).map((column) => <td key={column}>{(record as Record<string, unknown>)[column] === null || (record as Record<string, unknown>)[column] === undefined ? '—' : typeof (record as Record<string, unknown>)[column] === 'object' ? JSON.stringify((record as Record<string, unknown>)[column]) : String((record as Record<string, unknown>)[column])}</td>)}</tr>)}</tbody></table></div>}
          {moduleEndpoint && Array.isArray(moduleData.data) && moduleData.data.length === 0 && <div className="admin-empty">No records are available.</div>}
          {!moduleEndpoint && (portal.data.records.length ? <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr>{Object.keys(portal.data.records[0]).slice(0, 6).map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{portal.data.records.map((record, index) => <tr key={index}>{Object.keys(portal.data.records[0]).slice(0, 6).map((column) => <td key={column}>{record[column] === null || record[column] === undefined ? '—' : typeof record[column] === 'object' ? JSON.stringify(record[column]) : String(record[column])}</td>)}</tr>)}</tbody></table></div> : <div className="admin-empty">No records are available.</div>)}
        </section>
      </>}
    </section>
  </main>
}
