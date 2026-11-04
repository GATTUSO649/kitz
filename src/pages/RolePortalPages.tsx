import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery} from '@tanstack/react-query'
import { AlertTriangle, BarChart3, Boxes, CircleDollarSign, FileText, Megaphone, Package, Receipt, Search, ShoppingBag } from 'lucide-react'
import '../admin-theme.css'
import '../role-portal-theme.css'

const roleConfig = {
  'finance-admin': { role: 'finance_admin', title: 'Finance Operations', modules: ['Dashboard', 'Payments', 'M-Pesa', 'Reconciliation', 'Refunds', 'Revenue', 'Outstanding Payments', 'Expenses', 'Financial Reports', 'Analytics', 'Audit Logs', 'Notifications', 'Settings'], endpoints: { Payments: '/api/v1/admin/payments', Expenses: '/api/v1/admin/expenses', 'Financial Reports': '/api/v1/admin/reports/financial', 'Audit Logs': '/api/v1/admin/audit', Notifications: '/api/v1/admin/notifications' }, icon: CircleDollarSign },
  'inventory-admin': { role: 'inventory_admin', title: 'Inventory and Logistics', modules: ['Dashboard', 'Stock Management', 'Stock Movements', 'Low Stock', 'Out of Stock', 'Suppliers', 'Purchase Orders', 'Goods Receiving', 'Fulfillment', 'Returns', 'Analytics', 'Reports', 'Audit Logs', 'Notifications', 'Settings'], endpoints: { 'Stock Management': '/api/v1/admin/products', 'Stock Movements': '/api/v1/admin/inventory/movements', Fulfillment: '/api/v1/admin/orders', 'Audit Logs': '/api/v1/admin/audit' }, icon: Boxes },
  'marketing-admin': { role: 'marketing_admin', title: 'Marketing Operations', modules: ['Dashboard', 'Campaigns', 'Promotions', 'Coupons', 'Audiences', 'Email Marketing', 'Notifications', 'Content Promotion', 'Analytics', 'Reports', 'Audit Logs', 'Settings'], endpoints: { Campaigns: '/api/v1/admin/notifications', Notifications: '/api/v1/admin/notifications', 'Audit Logs': '/api/v1/admin/audit' }, icon: Megaphone },
  'content-admin': { role: 'content_admin', title: 'Products and Content', modules: ['Overview', 'Products', 'Categories', 'Homepage'], endpoints: { Products: '/api/v1/admin/products', Categories: '/api/v1/admin/categories', Homepage: '/api/v1/admin/homepage' }, icon: Package },
} as const

type PortalData = {
  role: string
  portal: string
  metrics: Record<string, number | string>
  series: { label: string; value: number }[]
  records: Record<string, unknown>[]
}

async function roleApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include', headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } })
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
      const payload = await response.json() as { data?: { portal: string; activationRequired?: boolean; activationToken?: string; roleNumber?: string; email?: string }; error?: { message?: string } }
      if (!response.ok) throw new Error(payload.error?.message ?? 'Administrator sign in failed.')
      if (payload.data?.activationRequired && payload.data.activationToken) {
        navigate(`/admin/activate?token=${encodeURIComponent(payload.data.activationToken)}&roleNumber=${encodeURIComponent(payload.data.roleNumber ?? identity)}&email=${encodeURIComponent(payload.data.email ?? '')}`, { replace: true })
        return
      }
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

type InventoryVariant = { id: number; size: string; sku: string; stock: number }
type InventoryProduct = { id: number; name: string; variants?: InventoryVariant[] }

function InventoryTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <div className="admin-empty">No inventory records are available.</div>
  const columns = Object.keys(rows[0]).slice(0, 7)
  return <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/([A-Z])/g, ' $1')}</th>)}</tr></thead><tbody>{rows.slice(0, 50).map((row, index) => <tr key={String(row.id ?? row.sku ?? index)}>{columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? '—' : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column])}</td>)}</tr>)}</tbody></table></div>
}

function InventoryUnavailable({ title, detail }: { title: string; detail: string }) {
  return <section className="inventory-panel inventory-unavailable"><AlertTriangle size={22} /><span className="admin-kicker">CONTROL NOT CONNECTED</span><h2>{title}</h2><p>{detail}</p></section>
}

function InventoryWorkspace({ prefix }: { prefix: keyof typeof roleConfig }) {
  const navigate = useNavigate()
  const [activeModule, setActiveModule] = useState('Dashboard')
  const [search, setSearch] = useState('')
  const [selectedVariant, setSelectedVariant] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const config = roleConfig[prefix]
  const portal = useQuery({ queryKey: ['inventory-portal'], queryFn: () => roleApi<PortalData>('/api/v1/admin/portal/inventory_admin'), retry: false })
  const products = useQuery({ queryKey: ['inventory-products'], queryFn: () => roleApi<InventoryProduct[]>('/api/v1/admin/products'), retry: false })
  const movements = useQuery({ queryKey: ['inventory-movements'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/inventory/movements'), enabled: activeModule === 'Stock Movements' || activeModule === 'Dashboard' || activeModule === 'Analytics', retry: false })
  const orders = useQuery({ queryKey: ['inventory-orders'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/orders'), enabled: activeModule === 'Fulfillment' || activeModule === 'Dashboard', retry: false })
  const audit = useQuery({ queryKey: ['inventory-audit'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/audit'), enabled: activeModule === 'Audit Logs', retry: false })
  const allProducts = products.data ?? []
  const stockRows = allProducts.flatMap((product) => (product.variants ?? []).map((variant) => ({ id: variant.id, productId: product.id, product: product.name, size: variant.size, sku: variant.sku, stock: variant.stock, status: variant.stock === 0 ? 'out of stock' : variant.stock <= 5 ? 'low stock' : 'in stock' })))
  const visibleRows = stockRows.filter((row) => `${row.product} ${row.size} ${row.sku} ${row.status}`.toLowerCase().includes(search.trim().toLowerCase()))
  const lowStock = stockRows.filter((row) => row.stock > 0 && row.stock <= 5)
  const outOfStock = stockRows.filter((row) => row.stock === 0)
  const units = stockRows.reduce((total, row) => total + row.stock, 0)
  const selected = stockRows.find((row) => String(row.id) === selectedVariant)

  async function adjustStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const form = new FormData(event.currentTarget)
    setError('')
    setNotice('')
    try {
      await roleApi(`/api/v1/admin/products/${selected.productId}/variants/${selected.id}/stock`, { method: 'POST', body: JSON.stringify({ delta: Number(form.get('delta')), note: String(form.get('note') ?? '').trim() }) })
      setNotice(`Stock updated for ${selected.product} ${selected.size}.`)
      event.currentTarget.reset()
      await Promise.all([products.refetch(), movements.refetch(), portal.refetch()])
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Stock adjustment failed.')
    }
  }

  const panel = activeModule === 'Dashboard' ? <>
    <div className="inventory-kpi-grid">{[['Products tracked', allProducts.length], ['Units in stock', units], ['Low-stock variants', lowStock.length], ['Out-of-stock variants', outOfStock.length], ['Movements recorded', portal.data?.metrics.movements ?? 0], ['Awaiting fulfillment', orders.data?.filter((order) => ['paid', 'processing'].includes(String(order.status))).length ?? 'Unavailable']].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{String(value)}</strong></article>)}</div>
    <div className="inventory-panel-grid"><section className="inventory-panel"><header><div><span className="admin-kicker">STOCK AVAILABILITY</span><h2>Inventory status</h2></div><Boxes size={19} /></header><div className="inventory-bars">{[['In stock', stockRows.filter((row) => row.stock > 5).length], ['Low stock', lowStock.length], ['Out of stock', outOfStock.length]].map(([label, value]) => <div key={String(label)}><span>{label}</span><i><b style={{ width: `${Math.max(4, Number(value) / Math.max(1, stockRows.length) * 100)}%` }} /></i><strong>{String(value)}</strong></div>)}</div></section><section className="inventory-panel"><header><div><span className="admin-kicker">INVENTORY ALERTS</span><h2>Attention required</h2></div><AlertTriangle size={19} /></header><div className="inventory-alert-list"><p>{lowStock.length} variants need replenishment.</p><p>{outOfStock.length} variants are unavailable.</p><p>{stockRows.length ? 'Inventory valuation is unavailable because reliable cost data is not configured.' : 'No stock data is available.'}</p></div></section></div>
    <section className="inventory-panel"><header><div><span className="admin-kicker">RECENT MOVEMENTS</span><h2>Stock activity</h2></div><Receipt size={19} /></header><InventoryTable rows={(movements.data ?? []).slice(0, 10)} /></section>
  </> : activeModule === 'Stock Management' || activeModule === 'Low Stock' || activeModule === 'Out of Stock' ? <section className="inventory-panel"><header><div><span className="admin-kicker">PRODUCT-LINKED STOCK</span><h2>{activeModule}</h2></div><Search size={19} /></header><label className="inventory-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, SKU, size or status" /></label>{activeModule === 'Low Stock' ? <InventoryTable rows={visibleRows.filter((row) => row.stock > 0 && row.stock <= 5)} /> : activeModule === 'Out of Stock' ? <InventoryTable rows={visibleRows.filter((row) => row.stock === 0)} /> : <InventoryTable rows={visibleRows} />}</section> : activeModule === 'Stock Movements' ? <section className="inventory-panel"><header><div><span className="admin-kicker">AUDITABLE STOCK HISTORY</span><h2>Stock movements</h2></div><Receipt size={19} /></header><InventoryTable rows={movements.data ?? []} /></section> : activeModule === 'Fulfillment' ? <section className="inventory-panel"><header><div><span className="admin-kicker">SALES ORDER VISIBILITY</span><h2>Fulfillment queue</h2></div><ShoppingBag size={19} /></header><p className="inventory-panel-copy">Customer orders remain owned by Sales. Inventory can view fulfillment workload without changing payment status.</p><InventoryTable rows={orders.data ?? []} /></section> : activeModule === 'Analytics' ? <section className="inventory-panel"><header><div><span className="admin-kicker">INVENTORY ANALYTICS</span><h2>Availability and movement summary</h2></div><BarChart3 size={19} /></header><div className="inventory-report-grid">{[['Total units', units], ['Tracked variants', stockRows.length], ['Low stock', lowStock.length], ['Out of stock', outOfStock.length], ['Movement records', movements.data?.length ?? 0], ['Cost valuation', 'Unavailable']].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{String(value)}</strong></article>)}</div><InventoryTable rows={(movements.data ?? []).slice(0, 10)} /></section> : activeModule === 'Audit Logs' ? <section className="inventory-panel"><header><div><span className="admin-kicker">INVENTORY ACCOUNTABILITY</span><h2>Audit logs</h2></div><FileText size={19} /></header><InventoryTable rows={audit.data ?? []} /></section> : activeModule === 'Dashboard' ? null : <InventoryUnavailable title={`${activeModule} is not connected`} detail="This workflow requires an additive inventory schema, audited server endpoint, and approved status transitions before it can be enabled." />
  return <main className="admin-it-page super-admin-page role-portal-shell inventory-portal-shell"><aside className="super-admin-sidebar role-portal-sidebar"><Link to="/" className="admin-brand"><img src="/culture-mark.webp" alt="" /> KitCulture</Link><strong>{config.title}</strong><nav>{config.modules.map((module) => <button type="button" key={module} className={activeModule === module ? 'active' : ''} onClick={() => { setActiveModule(module); setError(''); setNotice('') }}>{module}</button>)}</nav><button type="button" className="admin-it-button role-portal-signout" onClick={() => void signOutRolePortal(navigate, prefix)}>Sign out</button></aside><section className="super-admin-main role-portal-main inventory-portal-main"><header><div><span className="admin-kicker">INVENTORY CONTROL CENTRE</span><h1>{activeModule}</h1><p className="inventory-header-copy">Stock visibility, movement accountability, and fulfillment readiness for KitCulture.</p></div><Boxes size={24} /></header>{notice && <p className="inventory-notice" role="status">{notice}</p>}{error && <p className="inventory-error" role="alert">{error}</p>}{portal.isError || products.isError ? <div className="admin-empty admin-error">Inventory data is unavailable: {(portal.error ?? products.error)?.message}</div> : panel}{activeModule === 'Stock Management' && <section className="inventory-panel"><header><div><span className="admin-kicker">CONTROLLED MUTATION</span><h2>Adjust stock</h2></div><Boxes size={19} /></header><form className="inventory-adjust-form" onSubmit={(event) => void adjustStock(event)}><label>Variant<select value={selectedVariant} onChange={(event) => setSelectedVariant(event.target.value)} required><option value="">Select product variant</option>{stockRows.map((row) => <option key={row.id} value={row.id}>{row.product} · {row.size} · current {row.stock}</option>)}</select></label><label>Quantity change<input name="delta" type="number" min="-100000" max="100000" step="1" required placeholder="Positive to receive, negative to remove" /></label><label>Reason<input name="note" required maxLength={500} placeholder="Count correction, damaged, returned, received..." /></label><button className="role-portal-button" type="submit" disabled={!selectedVariant}>Record adjustment</button></form></section>}</section></main>
}

type MarketingCampaign = { id: number; type: string; title: string; body: string; href: string | null; audienceType: string; createdAt: string; recipientCount: number; unreadCount: number | null }

function MarketingTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <div className="admin-empty">No marketing records are available.</div>
  const columns = Object.keys(rows[0]).slice(0, 7)
  return <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/([A-Z])/g, ' $1')}</th>)}</tr></thead><tbody>{rows.slice(0, 50).map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? '—' : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column])}</td>)}</tr>)}</tbody></table></div>
}

function MarketingUnavailable({ title, detail }: { title: string; detail: string }) {
  return <section className="marketing-panel marketing-unavailable"><AlertTriangle size={22} /><span className="admin-kicker">CONTROL NOT CONNECTED</span><h2>{title}</h2><p>{detail}</p></section>
}

function MarketingWorkspace({ prefix }: { prefix: keyof typeof roleConfig }) {
  const navigate = useNavigate()
  const [activeModule, setActiveModule] = useState('Dashboard')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const config = roleConfig[prefix]
  const portal = useQuery({ queryKey: ['marketing-portal'], queryFn: () => roleApi<PortalData>('/api/v1/admin/portal/marketing_admin'), retry: false })
  const campaigns = useQuery({ queryKey: ['marketing-campaigns'], queryFn: () => roleApi<MarketingCampaign[]>('/api/v1/admin/notifications'), enabled: ['Dashboard', 'Campaigns', 'Notifications'].includes(activeModule), retry: false })
  const audit = useQuery({ queryKey: ['marketing-audit'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/audit'), enabled: activeModule === 'Audit Logs', retry: false })
  const campaignRows = (campaigns.data ?? []).filter((campaign) => campaign.type === 'announcement')
  const totalRecipients = campaignRows.reduce((total, campaign) => total + Number(campaign.recipientCount || 0), 0)
  const totalUnread = campaignRows.reduce((total, campaign) => total + Number(campaign.unreadCount || 0), 0)

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError('')
    setNotice('')
    try {
      const result = await roleApi<{ recipientCount: number }>('/api/v1/admin/notifications', { method: 'POST', body: JSON.stringify({ title: form.get('title'), body: form.get('body'), href: form.get('href') || undefined, audience: 'all' }) })
      event.currentTarget.reset()
      setNotice(`Notification campaign sent to ${result.recipientCount} customers.`)
      await Promise.all([campaigns.refetch(), portal.refetch()])
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Campaign could not be sent.')
    }
  }

  const panel = activeModule === 'Dashboard' ? <>
    <div className="marketing-kpi-grid">{[['Campaigns', campaignRows.length], ['Recipients reached', totalRecipients], ['Unread responses', totalUnread], ['Active promotions', 'Unavailable'], ['Email delivery', 'Unavailable'], ['Attributed revenue', 'Unavailable']].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{String(value)}</strong></article>)}</div>
    <div className="marketing-panel-grid"><section className="marketing-panel"><header><div><span className="admin-kicker">CAMPAIGN ACTIVITY</span><h2>Recent campaign reach</h2></div><Megaphone size={19} /></header><div className="marketing-bars">{campaignRows.slice(0, 6).map((campaign) => <div key={campaign.id}><span>{campaign.title}</span><i><b style={{ width: `${Math.max(4, Number(campaign.recipientCount) / Math.max(1, totalRecipients) * 100)}%` }} /></i><strong>{campaign.recipientCount}</strong></div>)}</div>{!campaignRows.length && <div className="admin-empty">No notification campaigns have been sent.</div>}</section><section className="marketing-panel"><header><div><span className="admin-kicker">ANALYTICS COVERAGE</span><h2>What is measurable</h2></div><BarChart3 size={19} /></header><div className="marketing-coverage"><p>Customer delivery and unread counts are available.</p><p>Open, click, conversion, and revenue attribution tracking is unavailable.</p></div></section></div>
    <section className="marketing-panel"><header><div><span className="admin-kicker">RECENT CAMPAIGNS</span><h2>Campaign history</h2></div><ShoppingBag size={19} /></header><MarketingTable rows={campaignRows as unknown as Record<string, unknown>[]} /></section>
  </> : activeModule === 'Campaigns' || activeModule === 'Notifications' ? <><section className="marketing-panel"><header><div><span className="admin-kicker">CUSTOMER NOTIFICATION CAMPAIGN</span><h2>{activeModule === 'Campaigns' ? 'Create campaign' : 'Compose notification'}</h2></div><Megaphone size={19} /></header><p className="marketing-panel-copy">This uses the existing in-app customer notification service and sends immediately to all customers. Scheduling, consent suppression, and email delivery are not represented by the current backend.</p><form className="marketing-campaign-form" onSubmit={(event) => void createCampaign(event)}><label>Campaign title<input name="title" required minLength={2} maxLength={160} /></label><label>Message<textarea name="body" required minLength={2} maxLength={2000} rows={4} /></label><label>In-app destination (optional)<input name="href" maxLength={320} placeholder="/account/marketplace" /></label>{error && <p className="marketing-error" role="alert">{error}</p>}{notice && <p className="marketing-notice" role="status">{notice}</p>}<button className="role-portal-button" type="submit">Send campaign</button></form></section><section className="marketing-panel"><header><div><span className="admin-kicker">DELIVERY HISTORY</span><h2>Sent campaigns</h2></div><FileText size={19} /></header><MarketingTable rows={campaignRows as unknown as Record<string, unknown>[]} /></section></> : activeModule === 'Audit Logs' ? <section className="marketing-panel"><header><div><span className="admin-kicker">MARKETING ACCOUNTABILITY</span><h2>Audit logs</h2></div><FileText size={19} /></header><MarketingTable rows={audit.data ?? []} /></section> : <MarketingUnavailable title={`${activeModule} is not connected`} detail="This workflow requires an additive marketing schema, consent-aware backend contract, and audited server operation before it can be enabled." />
  return <main className="admin-it-page super-admin-page role-portal-shell marketing-portal-shell"><aside className="super-admin-sidebar role-portal-sidebar"><Link to="/" className="admin-brand"><img src="/culture-mark.webp" alt="" /> KitCulture</Link><strong>{config.title}</strong><nav>{config.modules.map((module) => <button type="button" key={module} className={activeModule === module ? 'active' : ''} onClick={() => { setActiveModule(module); setError(''); setNotice('') }}>{module}</button>)}</nav><button type="button" className="admin-it-button role-portal-signout" onClick={() => void signOutRolePortal(navigate, prefix)}>Sign out</button></aside><section className="super-admin-main role-portal-main marketing-portal-main"><header><div><span className="admin-kicker">MARKETING MANAGEMENT CENTRE</span><h1>{activeModule}</h1><p className="marketing-header-copy">Campaign communication and measurable customer engagement for KitCulture.</p></div><Megaphone size={24} /></header>{portal.isError ? <div className="admin-empty admin-error">Marketing data is unavailable: {portal.error.message}</div> : panel}</section></main>
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
  if (prefix === 'inventory-admin') return <InventoryWorkspace prefix={prefix} />
  if (prefix === 'marketing-admin') return <MarketingWorkspace prefix={prefix} />
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
