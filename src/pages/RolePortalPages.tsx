import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BarChart3, Boxes, CalendarDays, Check, CircleDollarSign, Clock3, FileText, Mail, MapPin, Megaphone, Package, Receipt, Search, Shirt, ShoppingBag, Users } from 'lucide-react'
import '../admin-theme.css'
import '../role-portal-theme.css'

const roleConfig = {
  'finance-admin': { role: 'finance_admin', title: 'Finance Operations', modules: ['Dashboard', 'Payments', 'M-Pesa', 'Reconciliation', 'Refunds', 'Revenue', 'Outstanding Payments', 'Expenses', 'Financial Reports', 'Analytics', 'Audit Logs', 'Notifications', 'Settings'], endpoints: { Payments: '/api/v1/admin/payments', Expenses: '/api/v1/admin/expenses', 'Financial Reports': '/api/v1/admin/reports/financial', 'Audit Logs': '/api/v1/admin/audit', Notifications: '/api/v1/admin/notifications' }, icon: CircleDollarSign },
  'inventory-admin': { role: 'inventory_admin', title: 'Inventory and Logistics', modules: ['Dashboard', 'Stock Management', 'Stock Movements', 'Low Stock', 'Out of Stock', 'Suppliers', 'Purchase Orders', 'Goods Receiving', 'Fulfillment', 'Returns', 'Analytics', 'Reports', 'Audit Logs', 'Notifications', 'Settings'], endpoints: { 'Stock Management': '/api/v1/admin/products', 'Stock Movements': '/api/v1/admin/inventory/movements', Fulfillment: '/api/v1/admin/orders', 'Audit Logs': '/api/v1/admin/audit' }, icon: Boxes },
  'marketing-admin': { role: 'marketing_admin', title: 'Marketing Operations', modules: ['Dashboard', 'Campaigns', 'Promotions', 'Coupons', 'Audiences', 'Email Marketing', 'Notifications', 'Content Promotion', 'Analytics', 'Reports', 'Audit Logs', 'Settings'], endpoints: { Campaigns: '/api/v1/admin/notifications', Notifications: '/api/v1/admin/notifications', 'Audit Logs': '/api/v1/admin/audit' }, icon: Megaphone },
  'content-admin': { role: 'content_admin', title: 'Products and Content', modules: ['Overview', 'Products', 'Categories', 'Homepage', 'Site Pages'], endpoints: { Products: '/api/v1/admin/products', Categories: '/api/v1/admin/categories', Homepage: '/api/v1/admin/homepage', 'Site Pages': '/api/v1/admin/homepage/site-content' }, icon: Package },
  'laundry-admin': { role: 'laundry_admin', title: 'Laundry Admin', modules: ['Dashboard', 'Bookings', 'Payments', 'Pickup Locations'], endpoints: {}, icon: Shirt },
} as const

const portalByRole: Record<string, string> = {
  super_admin: '/super-admin/dashboard',
  it_admin: '/it-admin/dashboard',
  sales_admin: '/sales-admin/dashboard',
  finance_admin: '/finance-admin/dashboard',
  inventory_admin: '/inventory-admin/dashboard',
  marketing_admin: '/marketing-admin/dashboard',
  content_admin: '/content-admin/dashboard',
  laundry_admin: '/laundry-admin/dashboard',
}
const financeDefaultSettlementDate = new Date().toISOString().slice(0, 10)

type PortalData = {
  role: string
  portal: string
  metrics: Record<string, number | string>
  series: { label: string; value: number }[]
  records: Record<string, unknown>[]
}

async function roleApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include', headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } })
  if (response.status === 401) window.dispatchEvent(new Event('kitculture:admin-session-expired'))
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? 'The administrator portal is unavailable.')
  return payload.data as T
}

type LaundryPageResponse<T> = { data: T; pagination: { page: number; limit: number; total: number } }

async function roleApiPage<T>(path: string): Promise<LaundryPageResponse<T>> {
  const response = await fetch(path, { credentials: 'include' })
  if (response.status === 401) window.dispatchEvent(new Event('kitculture:admin-session-expired'))
  const payload = await response.json().catch(() => ({})) as {
    data?: T
    pagination?: LaundryPageResponse<T>['pagination']
    error?: { message?: string }
  }
  if (!response.ok) throw new Error(payload.error?.message ?? 'The laundry records are unavailable.')
  if (!Array.isArray(payload.data) || !payload.pagination
    || !Number.isFinite(payload.pagination.page)
    || !Number.isFinite(payload.pagination.limit)
    || !Number.isFinite(payload.pagination.total)) {
    throw new Error('The laundry records response is incomplete. Refresh the page and try again.')
  }
  return payload as LaundryPageResponse<T>
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
      const response = await fetch(`/api/v1/admin/${prefix}/login`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity, password, expectedRole: config.role }) })
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

  return <main className="role-portal-login"><section className="role-portal-login-card"><Link to="/" className="role-portal-login-brand" aria-label="MATRIX home"><img src="/matrix-logo.png" alt="MATRIX" /></Link><span className="admin-kicker">RESTRICTED {prefix.replace('-admin', '').toUpperCase()} ACCESS</span><h1>{config.title}</h1><p>Sign in with the role number or email assigned to this administrator portal.</p><form onSubmit={(event) => void submit(event)}><label>Role number or email<input value={identity} onChange={(event) => setIdentity(event.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p className="admin-error" role="alert">{error}</p>}<button className="role-portal-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : `Sign in to ${config.title}`}</button></form><Link className="role-portal-login-link" to="/admin/login">Existing Sales Admin sign in</Link></section></main>
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

type FinanceRefund = { id: number; paymentId: number; orderNumber: string; amount: string; reason: string; status: string; providerReference: string | null; resolutionNote: string | null; createdAt: string }

function FinanceRefundsPanel() {
  const queryClient = useQueryClient()
  const refunds = useQuery({ queryKey: ['finance-refunds'], queryFn: () => roleApi<FinanceRefund[]>('/api/v1/admin/finance/refunds'), retry: false })
  const payments = useQuery({ queryKey: ['finance-payments'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/payments'), retry: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function createRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await roleApi('/api/v1/admin/finance/refunds', { method: 'POST', body: JSON.stringify({ paymentId: Number(form.get('paymentId')), amount: form.get('amount'), reason: form.get('reason') }) })
      formElement.reset()
      setNotice('Refund request recorded for review.')
      await Promise.all([refunds.refetch(), queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] })])
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Refund request could not be recorded.')
    } finally {
      setBusy(false)
    }
  }

  async function updateRefund(id: number, action: 'approve' | 'reject' | 'mark_paid', form?: HTMLFormElement) {
    const values = form ? new FormData(form) : null
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await roleApi(`/api/v1/admin/finance/refunds/${id}`, { method: 'PATCH', body: JSON.stringify({ action, note: values?.get('note') || undefined, providerReference: values?.get('providerReference') || undefined }) })
      setNotice(`Refund ${id} updated.`)
      await Promise.all([refunds.refetch(), queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] })])
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Refund could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  const refundablePayments = (payments.data ?? []).filter((payment) => ['succeeded', 'refunded'].includes(String(payment.status)))
  return <>
    <section className="finance-panel"><header><div><span className="admin-kicker">CONTROLLED PAYOUT WORKFLOW</span><h2>Request a refund</h2></div><Receipt size={19} /></header>
      <p className="finance-panel-copy">Requests are checked against the payment’s remaining balance. Payout is manual; record the external provider reference before marking it paid.</p>
      <form className="finance-settings-form" onSubmit={(event) => void createRefund(event)}><label>Successful payment<select name="paymentId" required defaultValue=""><option value="" disabled>Select payment</option>{refundablePayments.map((payment) => <option key={String(payment.id)} value={String(payment.id)}>{String(payment.orderNumber ?? `Payment ${payment.id}`)} · KES {String(payment.amount)} · {String(payment.status)}</option>)}</select></label><label>Amount (KES)<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Reason<input name="reason" minLength={3} maxLength={500} required /></label>{error && <p className="activation-error" role="alert">{error}</p>}{notice && <p className="activation-success" role="status">{notice}</p>}<button className="role-portal-button" type="submit" disabled={busy || !refundablePayments.length}>{busy ? 'Saving…' : 'Request refund'}</button></form>
    </section>
    <section className="finance-panel"><header><div><span className="admin-kicker">REVIEW AND PAYOUT TRACKING</span><h2>Refund requests</h2></div><FileText size={19} /></header>{refunds.isError ? <div className="admin-empty admin-error">Refund requests unavailable: {refunds.error.message}</div> : <div className="finance-refund-list">{(refunds.data ?? []).map((refund) => <article key={refund.id}><div><strong>{refund.orderNumber} · KES {refund.amount}</strong><small>{refund.reason}</small><small>{refund.status}{refund.providerReference ? ` · ${refund.providerReference}` : ''}</small></div>{refund.status === 'requested' && <div><button className="admin-it-button" type="button" disabled={busy} onClick={() => void updateRefund(refund.id, 'approve')}>Approve</button><button className="admin-it-button is-danger" type="button" disabled={busy} onClick={() => void updateRefund(refund.id, 'reject')}>Reject</button></div>}{refund.status === 'approved' && <form onSubmit={(event) => { event.preventDefault(); void updateRefund(refund.id, 'mark_paid', event.currentTarget) }}><label>External payout reference<input name="providerReference" required minLength={2} maxLength={120} /></label><label>Note<input name="note" maxLength={500} /></label><button className="admin-it-button" type="submit" disabled={busy}>Record payout</button></form>}</article>)}{refunds.isPending && <div className="admin-empty">Loading refund requests…</div>}{!refunds.isPending && !refunds.data?.length && <div className="admin-empty">No refund requests have been recorded.</div>}</div>}</section>
  </>
}

function FinanceReconciliationPanel() {
  const reconciliation = useQuery({ queryKey: ['finance-reconciliation'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/finance/reconciliation'), retry: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function reconcile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await roleApi('/api/v1/admin/finance/reconciliation', { method: 'POST', body: JSON.stringify({ settlementDate: form.get('settlementDate'), providerAmount: form.get('providerAmount'), note: form.get('note') || undefined }) })
      setNotice('Settlement reconciliation saved.')
      await reconciliation.refetch()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Settlement could not be reconciled.')
    } finally {
      setBusy(false)
    }
  }
  return <>
    <section className="finance-panel"><header><div><span className="admin-kicker">SETTLEMENT REVIEW</span><h2>Record provider settlement</h2></div><Receipt size={19} /></header><p className="finance-panel-copy">Internal totals are calculated from successful payments for the selected date. Compare with the provider statement before saving.</p><form className="finance-settings-form" onSubmit={(event) => void reconcile(event)}><label>Settlement date<input name="settlementDate" type="date" required defaultValue={financeDefaultSettlementDate} /></label><label>Provider amount (KES)<input name="providerAmount" type="number" min="0" step="0.01" required /></label><label>Reconciliation note<input name="note" maxLength={500} /></label>{error && <p className="activation-error" role="alert">{error}</p>}{notice && <p className="activation-success" role="status">{notice}</p>}<button className="role-portal-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save reconciliation'}</button></form></section>
    <section className="finance-panel"><header><div><span className="admin-kicker">SETTLEMENT HISTORY</span><h2>Reconciliations</h2></div><FileText size={19} /></header>{reconciliation.isError ? <div className="admin-empty admin-error">Reconciliation data unavailable: {reconciliation.error.message}</div> : <FinanceTable rows={reconciliation.data ?? []} />}</section>
  </>
}

function FinanceOutstandingPanel() {
  const payments = useQuery({ queryKey: ['finance-payments'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/payments'), retry: false })
  const outstanding = (payments.data ?? []).filter((payment) => ['pending', 'processing', 'created'].includes(String(payment.status)))
  return <section className="finance-panel"><header><div><span className="admin-kicker">PAYMENT FOLLOW-UP</span><h2>Outstanding payments</h2></div><Receipt size={19} /></header><p className="finance-panel-copy">Only server-recorded pending payments are shown. Do not mark a payment as settled based on a customer screenshot.</p>{payments.isError ? <div className="admin-empty admin-error">Outstanding payments unavailable: {payments.error.message}</div> : <FinanceTable rows={outstanding} />}</section>
}

function FinanceAnalyticsPanel() {
  const dashboard = useQuery({ queryKey: ['finance-dashboard'], queryFn: () => roleApi<FinanceDashboard>('/api/v1/admin/dashboard?period=last30days'), retry: false })
  const report = useQuery({ queryKey: ['finance-report'], queryFn: () => roleApi<FinanceReport>('/api/v1/admin/reports/financial'), retry: false })
  if (dashboard.isError || report.isError) return <div className="admin-empty admin-error">Finance analytics unavailable: {(dashboard.error ?? report.error)?.message}</div>
  return <section className="finance-panel"><header><div><span className="admin-kicker">PAYMENTS AND REVENUE</span><h2>Financial analytics</h2></div><BarChart3 size={19} /></header><div className="finance-report-grid">{[['Paid revenue', currency(dashboard.data?.paidRevenue ?? 0)], ['Paid payments', String(dashboard.data?.paidPayments ?? 0)], ['Pending orders', String(dashboard.data?.pendingOrders ?? 0)], ['Collected payments', currency(report.data?.collectedPayments ?? 0)], ['Discounts', currency(report.data?.discounts ?? 0)], ['Cost data', report.data?.profitAvailable ? 'Available' : 'Not configured']].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div><p className="finance-panel-copy">Figures reflect recorded payments and configured product costs; this view does not estimate untracked cash settlements.</p></section>
}

function FinanceUnavailable({ title, detail }: { title: string; detail: string }) {
  if (title === 'Settings is not connected') return <FinanceSettingsPanel />
  if (title.startsWith('Refunds')) return <FinanceRefundsPanel />
  if (title.startsWith('Reconciliation')) return <FinanceReconciliationPanel />
  if (title.startsWith('Outstanding Payments')) return <FinanceOutstandingPanel />
  if (title.startsWith('Analytics')) return <FinanceAnalyticsPanel />
  return <section className="finance-panel finance-unavailable"><AlertTriangle size={22} /><span className="admin-kicker">CONTROL NOT CONNECTED</span><h2>{title}</h2><p>{detail}</p></section>
}

function FinanceSettingsPanel() {
  const settings = useQuery({ queryKey: ['finance-settings'], queryFn: () => roleApi<{ mpesaTillName?: string; mpesaTillNumber?: string; mpesaMobileNumber?: string }>('/api/v1/admin/finance/settings'), retry: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await roleApi('/api/v1/admin/finance/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          mpesaTillName: String(form.get('mpesaTillName') ?? '').trim(),
          mpesaTillNumber: String(form.get('mpesaTillNumber') ?? '').trim(),
          mpesaMobileNumber: String(form.get('mpesaMobileNumber') ?? '').trim(),
        }),
      })
      await settings.refetch()
      setSaved(true)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Finance settings could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="finance-panel"><header><div><span className="admin-kicker">CHECKOUT PAYMENT DETAILS</span><h2>M-Pesa settings</h2></div><Receipt size={19} /></header><p className="finance-panel-copy">These merchant details appear to customers at checkout. Do not enter Daraja passwords, passkeys, or API credentials here.</p>{settings.isPending ? <div className="admin-empty">Loading finance settings...</div> : settings.isError ? <div className="admin-empty admin-error">Finance settings are unavailable: {settings.error.message}</div> : <form className="finance-settings-form" onSubmit={(event) => void save(event)} key={settings.dataUpdatedAt}><label>Till display name<input name="mpesaTillName" required minLength={2} maxLength={120} defaultValue={settings.data?.mpesaTillName ?? ''} /></label><label>M-Pesa Till or PayBill number<input name="mpesaTillNumber" inputMode="numeric" pattern="[0-9]{5,20}" maxLength={20} defaultValue={settings.data?.mpesaTillNumber ?? ''} placeholder="Optional" /></label><label>Manual payment mobile number<input name="mpesaMobileNumber" type="tel" pattern="(?:\+?254|0)[17][0-9]{8}" maxLength={13} defaultValue={settings.data?.mpesaMobileNumber ?? ''} placeholder="Optional, e.g. 0712345678" /></label>{error && <p className="activation-error" role="alert">{error}</p>}{saved && <p className="activation-success" role="status">Finance settings saved and the change was audit logged.</p>}<button className="role-portal-button" type="submit" disabled={busy}>{busy ? 'Saving settings...' : 'Save Finance settings'}</button></form>}</section>
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
  const payments = useQuery({ queryKey: ['finance-payments'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/payments'), enabled: ['Dashboard', 'Payments', 'M-Pesa', 'Outstanding Payments'].includes(activeModule), retry: false })
  const refunds = useQuery({ queryKey: ['finance-refunds'], queryFn: () => roleApi<FinanceRefund[]>('/api/v1/admin/finance/refunds'), enabled: activeModule === 'Dashboard' || activeModule === 'Refunds', retry: false })
  const expenses = useQuery({ queryKey: ['finance-expenses'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/expenses'), enabled: activeModule === 'Expenses', retry: false })
  const audit = useQuery({ queryKey: ['finance-audit'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/audit'), enabled: activeModule === 'Audit Logs', retry: false })
  const notifications = useQuery({ queryKey: ['finance-notifications'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/notifications'), enabled: activeModule === 'Notifications', retry: false })
  const config = roleConfig[prefix]
  const data = dashboard.data
  const reportData = report.data
  const metricCards = [
    ['Total revenue', currency(data?.paidRevenue ?? 0)], ['Payments received', String(data?.paidPayments ?? 0)],
    ['Pending payments', String(data?.pendingOrders ?? 0)], ['Outstanding balance', payments.isError ? 'Unavailable' : payments.isPending ? 'Loading' : currency((payments.data ?? []).filter((payment) => ['pending', 'processing', 'created'].includes(String(payment.status))).reduce((total, payment) => total + Number(payment.amount ?? 0), 0))],
    ['Refund requests', refunds.isError ? 'Unavailable' : refunds.isPending ? 'Loading' : String(refunds.data?.length ?? 0)], ['Net revenue', reportData ? currency(Number(reportData.collectedPayments) - Number(reportData.discounts)) : 'Loading'],
  ]
  const panel = activeModule === 'Dashboard' ? <>
    <div className="finance-kpi-grid">{metricCards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    <div className="finance-panel-grid"><section className="finance-panel"><header><div><span className="admin-kicker">REVENUE TREND · LAST 30 DAYS</span><h2>Settled revenue</h2></div><BarChart3 size={19} /></header><FinanceTrend points={data?.revenueTrend ?? []} /></section><section className="finance-panel"><header><div><span className="admin-kicker">PAYMENT STATUS</span><h2>Transaction distribution</h2></div><Receipt size={19} /></header><div className="finance-bars">{(portal.data?.series ?? []).map((point) => <div key={point.label}><span>{point.label}</span><i><b style={{ width: `${Math.max(4, point.value / Math.max(1, ...(portal.data?.series ?? []).map((item) => item.value)) * 100)}%` }} /></i><strong>{point.value}</strong></div>)}</div></section></div>
    <section className="finance-panel"><header><div><span className="admin-kicker">RECENT FINANCIAL ACTIVITY</span><h2>Latest transactions</h2></div><ShoppingBag size={19} /></header><FinanceTable rows={portal.data?.records ?? []} /></section>
  </> : activeModule === 'Payments' || activeModule === 'M-Pesa' ? <section className="finance-panel"><header><div><span className="admin-kicker">{activeModule === 'M-Pesa' ? 'SAFARICOM DARaja' : 'PAYMENT MANAGEMENT'}</span><h2>{activeModule}</h2></div><Receipt size={19} /></header><p className="finance-panel-copy">Trusted backend payment records only. Customer screenshots and submitted transaction codes are not used as confirmation.</p><FinanceTable rows={payments.data ?? portal.data?.records ?? []} /></section> : activeModule === 'Expenses' ? <section className="finance-panel"><header><div><span className="admin-kicker">OPERATING COSTS</span><h2>Expense management</h2></div><Receipt size={19} /></header><FinanceTable rows={expenses.data ?? []} /></section> : activeModule === 'Revenue' ? <section className="finance-panel"><header><div><span className="admin-kicker">REVENUE MANAGEMENT</span><h2>Revenue and margin view</h2></div><BarChart3 size={19} /></header><div className="finance-report-grid">{Object.entries(reportData ?? {}).filter(([key]) => key !== 'profitAvailable').map(([key, value]) => <article key={key}><span>{key.replace(/([A-Z])/g, ' $1')}</span><strong>{key === 'costOfGoodsSold' && value === null ? 'Unavailable' : currency(String(value))}</strong></article>)}</div><p className="finance-panel-copy">Profit is shown only when product cost data is available.</p></section> : activeModule === 'Financial Reports' ? <section className="finance-panel"><header><div><span className="admin-kicker">REPORTING CENTRE</span><h2>Financial reports</h2></div><FileText size={19} /></header><div className="finance-report-grid">{Object.entries(reportData ?? {}).map(([key, value]) => <article key={key}><span>{key.replace(/([A-Z])/g, ' $1')}</span><strong>{typeof value === 'boolean' ? value ? 'Available' : 'Unavailable' : currency(String(value))}</strong></article>)}</div><p className="finance-panel-copy">CSV, Excel, and PDF exports require a reviewed export endpoint and are not enabled yet.</p></section> : activeModule === 'Audit Logs' ? <section className="finance-panel"><header><div><span className="admin-kicker">FINANCIAL ACCOUNTABILITY</span><h2>Audit activity</h2></div><FileText size={19} /></header><FinanceTable rows={audit.data ?? []} /></section> : activeModule === 'Notifications' ? <section className="finance-panel"><header><div><span className="admin-kicker">FINANCE NOTIFICATIONS</span><h2>Notification history</h2></div><Receipt size={19} /></header><FinanceTable rows={notifications.data ?? []} /></section> : <FinanceUnavailable title={`${activeModule} is not connected`} detail="This control requires an additive finance workflow, database contract, and audited server mutation before it can be enabled." />
  return <main className="admin-it-page super-admin-page role-portal-shell finance-portal-shell"><aside className="super-admin-sidebar role-portal-sidebar"><Link to="/" className="admin-brand" aria-label="MATRIX home"><img src="/matrix-logo.png" alt="MATRIX" /></Link><strong>{config.title}</strong><nav>{config.modules.map((module) => <button type="button" key={module} className={activeModule === module ? 'active' : ''} onClick={() => { const adminPath = ({ Dashboard: '/admin', Payments: '/admin/payments', 'M-Pesa': '/admin/payments', Revenue: '/admin/reports', 'Financial Reports': '/admin/reports', Expenses: '/admin/expenses', 'Audit Logs': '/admin/audit' } as Record<string, string>)[module]; if (adminPath) navigate(adminPath); else setActiveModule(module) }}>{module}</button>)}</nav><button type="button" className="admin-it-button role-portal-signout" onClick={() => void signOutRolePortal(navigate, prefix)}>Sign out</button></aside><section className="super-admin-main role-portal-main finance-portal-main"><header><div><span className="admin-kicker">FINANCIAL MANAGEMENT AND CONTROL</span><h1>{activeModule}</h1><p className="finance-header-copy">Revenue, payments, accountability, and financial control for KitCulture.</p></div><CircleDollarSign size={24} /></header>{portal.isError || dashboard.isError ? <div className="admin-empty admin-error">Finance data is unavailable: {(portal.error ?? dashboard.error)?.message}</div> : panel}</section></main>
}

type InventoryVariant = { id: number; size: string; sku: string; stock: number }
type InventoryProduct = { id: number; name: string; variants?: InventoryVariant[] }
type InventorySupplier = { id: number; name: string; contactName: string | null; email: string | null; phone: string | null; active: boolean; notes: string | null }
type PurchaseOrderLine = { id: number; variantId: number; productName: string; size: string; sku: string; quantityOrdered: number; quantityReceived: number; unitCost: string }
type InventoryPurchaseOrder = { id: number; status: string; note: string | null; expectedAt: string | null; createdAt: string; receivedAt: string | null; supplierId: number; supplierName: string; lines: PurchaseOrderLine[] }
type EligibleReturnItem = { id: number; orderNumber: string; productName: string; size: string; quantity: number; remainingQuantity: number; createdAt: string }
type InventoryReturn = { id: number; orderId: number; orderNumber: string; orderItemId: number; productName: string; size: string; quantity: number; reason: string; status: string; resolutionNote: string | null; createdAt: string }

function InventoryTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <div className="admin-empty">No inventory records are available.</div>
  const columns = Object.keys(rows[0]).slice(0, 7)
  return <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/([A-Z])/g, ' $1')}</th>)}</tr></thead><tbody>{rows.slice(0, 50).map((row, index) => <tr key={String(row.id ?? row.sku ?? index)}>{columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? '—' : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column])}</td>)}</tr>)}</tbody></table></div>
}

function InventorySuppliersPanel() {
  const suppliers = useQuery({ queryKey: ['inventory-suppliers'], queryFn: () => roleApi<InventorySupplier[]>('/api/v1/admin/inventory/suppliers'), retry: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await roleApi('/api/v1/admin/inventory/suppliers', { method: 'POST', body: JSON.stringify({ name: form.get('name'), contactName: form.get('contactName') || undefined, email: form.get('email') || undefined, phone: form.get('phone') || undefined, notes: form.get('notes') || undefined }) })
      formElement.reset()
      setNotice('Supplier added.')
      await suppliers.refetch()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Supplier could not be added.')
    } finally {
      setBusy(false)
    }
  }
  async function toggleSupplier(supplier: InventorySupplier) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await roleApi(`/api/v1/admin/inventory/suppliers/${supplier.id}`, { method: 'PATCH', body: JSON.stringify({ active: !supplier.active }) })
      setNotice(`${supplier.name} ${supplier.active ? 'deactivated' : 'activated'}.`)
      await suppliers.refetch()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Supplier status could not be changed.')
    } finally {
      setBusy(false)
    }
  }
  return <>
    <section className="inventory-panel"><header><div><span className="admin-kicker">PURCHASING DIRECTORY</span><h2>Add supplier</h2></div><Boxes size={19} /></header><form className="inventory-adjust-form" onSubmit={(event) => void createSupplier(event)}><label>Supplier name<input name="name" minLength={2} maxLength={160} required /></label><label>Contact name<input name="contactName" maxLength={160} /></label><label>Email<input name="email" type="email" maxLength={254} /></label><label>Phone<input name="phone" maxLength={32} /></label><label>Notes<input name="notes" maxLength={1000} /></label>{error && <p className="inventory-error" role="alert">{error}</p>}{notice && <p className="inventory-notice" role="status">{notice}</p>}<button className="admin-it-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add supplier'}</button></form></section>
    <section className="inventory-panel"><header><div><span className="admin-kicker">ACTIVE PURCHASING SOURCES</span><h2>Suppliers</h2></div><FileText size={19} /></header>{suppliers.isError ? <div className="admin-empty admin-error">Suppliers unavailable: {suppliers.error.message}</div> : <div className="inventory-supplier-list">{(suppliers.data ?? []).map((supplier) => <article key={supplier.id}><div><strong>{supplier.name}</strong><small>{[supplier.contactName, supplier.email, supplier.phone].filter(Boolean).join(' · ') || 'No contact details'}</small></div><span>{supplier.active ? 'Active' : 'Inactive'}</span><button className="admin-it-button" type="button" disabled={busy} onClick={() => void toggleSupplier(supplier)}>{supplier.active ? 'Deactivate' : 'Activate'}</button></article>)}{!suppliers.isPending && !suppliers.data?.length && <div className="admin-empty">No suppliers have been added.</div>}</div>}</section>
  </>
}

function InventoryPurchaseOrdersPanel({ mode = 'orders' }: { mode?: 'orders' | 'receiving' }) {
  const queryClient = useQueryClient()
  const orders = useQuery({ queryKey: ['inventory-purchase-orders'], queryFn: () => roleApi<InventoryPurchaseOrder[]>('/api/v1/admin/inventory/purchase-orders'), retry: false })
  const suppliers = useQuery({ queryKey: ['inventory-suppliers'], queryFn: () => roleApi<InventorySupplier[]>('/api/v1/admin/inventory/suppliers'), retry: false })
  const products = useQuery({ queryKey: ['inventory-products'], queryFn: () => roleApi<InventoryProduct[]>('/api/v1/admin/products'), retry: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const variants = (products.data ?? []).flatMap((product) => (product.variants ?? []).map((variant) => ({ ...variant, productName: product.name })))

  async function createPurchaseOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const expectedAt = String(form.get('expectedAt') ?? '').trim()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await roleApi('/api/v1/admin/inventory/purchase-orders', { method: 'POST', body: JSON.stringify({ supplierId: Number(form.get('supplierId')), note: form.get('note') || undefined, expectedAt: expectedAt ? new Date(expectedAt).toISOString() : undefined, lines: [{ variantId: Number(form.get('variantId')), quantity: Number(form.get('quantity')), unitCost: form.get('unitCost') }] }) })
      formElement.reset()
      setNotice('Purchase order created in draft status.')
      await orders.refetch()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Purchase order could not be created.')
    } finally {
      setBusy(false)
    }
  }

  async function transition(order: InventoryPurchaseOrder, action: 'approve' | 'order' | 'cancel') {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await roleApi(`/api/v1/admin/inventory/purchase-orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      setNotice(`Purchase order ${order.id} updated.`)
      await Promise.all([orders.refetch(), queryClient.invalidateQueries({ queryKey: ['inventory-portal'] })])
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Purchase order could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  async function receive(event: FormEvent<HTMLFormElement>, order: InventoryPurchaseOrder) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const lines = order.lines.flatMap((line) => {
      const quantity = Number(form.get(`line-${line.id}`) ?? 0)
      return quantity > 0 ? [{ lineId: line.id, quantity }] : []
    })
    if (!lines.length) {
      setError('Enter at least one received quantity.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await roleApi<{ complete: boolean }>(`/api/v1/admin/inventory/purchase-orders/${order.id}/receive`, { method: 'POST', body: JSON.stringify({ lines }) })
      setNotice(result.complete ? `Purchase order ${order.id} received in full.` : `Partial receipt recorded for purchase order ${order.id}.`)
      await Promise.all([orders.refetch(), products.refetch(), queryClient.invalidateQueries({ queryKey: ['inventory-movements'] })])
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Goods receipt could not be recorded.')
    } finally {
      setBusy(false)
    }
  }

  const visibleOrders = (orders.data ?? []).filter((order) => mode === 'receiving' ? order.status === 'ordered' : true)
  return <>
    {mode === 'orders' && <section className="inventory-panel"><header><div><span className="admin-kicker">REPLENISHMENT WORKFLOW</span><h2>Create purchase order</h2></div><Boxes size={19} /></header><form className="inventory-adjust-form" onSubmit={(event) => void createPurchaseOrder(event)}><label>Active supplier<select name="supplierId" required defaultValue=""><option value="" disabled>Select supplier</option>{(suppliers.data ?? []).filter((supplier) => supplier.active).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label>Product variant<select name="variantId" required defaultValue=""><option value="" disabled>Select variant</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.productName} · {variant.size} · {variant.sku}</option>)}</select></label><label>Quantity<input name="quantity" type="number" min="1" max="100000" step="1" required /></label><label>Unit cost (KES)<input name="unitCost" type="number" min="0" step="0.01" required /></label><label>Expected delivery<input name="expectedAt" type="datetime-local" /></label><label>Note<input name="note" maxLength={1000} /></label>{error && <p className="inventory-error" role="alert">{error}</p>}{notice && <p className="inventory-notice" role="status">{notice}</p>}<button className="admin-it-button" type="submit" disabled={busy || !suppliers.data?.some((supplier) => supplier.active) || !variants.length}>{busy ? 'Saving…' : 'Create draft order'}</button></form></section>}
    <section className="inventory-panel"><header><div><span className="admin-kicker">{mode === 'receiving' ? 'ORDERED GOODS' : 'PURCHASING WORKFLOW'}</span><h2>{mode === 'receiving' ? 'Goods receiving' : 'Purchase orders'}</h2></div><Receipt size={19} /></header>{orders.isError ? <div className="admin-empty admin-error">Purchase orders unavailable: {orders.error.message}</div> : <div className="inventory-purchase-list">{visibleOrders.map((order) => <article key={order.id}><header><div><strong>PO-{order.id} · {order.supplierName}</strong><small>{order.status} · {order.expectedAt ? `Expected ${new Date(order.expectedAt).toLocaleDateString()}` : 'No expected date'}</small></div><span>{order.lines.length} line{order.lines.length === 1 ? '' : 's'}</span></header><div className="inventory-purchase-lines">{order.lines.map((line) => <p key={line.id}>{line.productName} · {line.size} · {line.sku} · {line.quantityReceived}/{line.quantityOrdered} received</p>)}</div>{mode === 'orders' && <div className="inventory-row-actions">{order.status === 'draft' && <button className="admin-it-button" type="button" disabled={busy} onClick={() => void transition(order, 'approve')}>Approve</button>}{order.status === 'approved' && <button className="admin-it-button" type="button" disabled={busy} onClick={() => void transition(order, 'order')}>Mark ordered</button>}{['draft', 'approved', 'ordered'].includes(order.status) && <button className="admin-it-button is-danger" type="button" disabled={busy} onClick={() => void transition(order, 'cancel')}>Cancel</button>}</div>}{order.status === 'ordered' && <form className="inventory-receipt-form" onSubmit={(event) => void receive(event, order)}><strong>Record received quantities</strong><div>{order.lines.filter((line) => line.quantityReceived < line.quantityOrdered).map((line) => <label key={line.id}>{line.productName} · {line.size} ({line.quantityOrdered - line.quantityReceived} remaining)<input name={`line-${line.id}`} type="number" min="0" max={line.quantityOrdered - line.quantityReceived} step="1" defaultValue="0" /></label>)}</div><button className="admin-it-button" type="submit" disabled={busy}>Receive goods</button></form>}</article>)}{orders.isPending && <div className="admin-empty">Loading purchase orders…</div>}{!orders.isPending && !visibleOrders.length && <div className="admin-empty">{mode === 'receiving' ? 'No ordered goods are waiting to be received.' : 'No purchase orders have been created.'}</div>}</div>}</section>
  </>
}

function InventoryReturnsPanel() {
  const queryClient = useQueryClient()
  const returns = useQuery({ queryKey: ['inventory-returns'], queryFn: () => roleApi<InventoryReturn[]>('/api/v1/admin/inventory/returns'), retry: false })
  const eligible = useQuery({ queryKey: ['inventory-return-eligible-items'], queryFn: () => roleApi<EligibleReturnItem[]>('/api/v1/admin/inventory/returns/eligible-items'), retry: false })
  const [busy, setBusy] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function createReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await roleApi('/api/v1/admin/inventory/returns', { method: 'POST', body: JSON.stringify({ orderItemId: Number(form.get('orderItemId')), quantity: Number(form.get('quantity')), reason: form.get('reason') }) })
      formElement.reset()
      setSelectedItemId('')
      setNotice('Return request recorded.')
      await Promise.all([returns.refetch(), eligible.refetch()])
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Return request could not be recorded.')
    } finally {
      setBusy(false)
    }
  }
  async function updateReturn(item: InventoryReturn, action: 'approve' | 'reject' | 'receive', form?: HTMLFormElement) {
    const note = form ? String(new FormData(form).get('note') ?? '') : ''
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await roleApi(`/api/v1/admin/inventory/returns/${item.id}`, { method: 'PATCH', body: JSON.stringify({ action, note: note || undefined }) })
      setNotice(`Return ${item.id} updated.`)
      await Promise.all([returns.refetch(), eligible.refetch(), queryClient.invalidateQueries({ queryKey: ['inventory-products'] }), queryClient.invalidateQueries({ queryKey: ['inventory-movements'] })])
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Return status could not be changed.')
    } finally {
      setBusy(false)
    }
  }
  return <>
    <section className="inventory-panel"><header><div><span className="admin-kicker">DELIVERED ORDERS · 30 DAY WINDOW</span><h2>Record return request</h2></div><Receipt size={19} /></header><form className="inventory-adjust-form" onSubmit={(event) => void createReturn(event)}><label>Eligible order item<select name="orderItemId" required value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)}><option value="" disabled>Select item</option>{(eligible.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.orderNumber} · {item.productName} · {item.size} · {item.remainingQuantity} returnable</option>)}</select></label><label>Quantity<input name="quantity" type="number" min="1" max={eligible.data?.find((item) => String(item.id) === selectedItemId)?.remainingQuantity ?? 1} defaultValue="1" required /></label><label>Reason<input name="reason" minLength={3} maxLength={500} required /></label>{error && <p className="inventory-error" role="alert">{error}</p>}{notice && <p className="inventory-notice" role="status">{notice}</p>}<button className="admin-it-button" type="submit" disabled={busy || !eligible.data?.length}>Create return request</button></form></section>
    <section className="inventory-panel"><header><div><span className="admin-kicker">REVIEW AND RESTOCK</span><h2>Return requests</h2></div><FileText size={19} /></header>{returns.isError ? <div className="admin-empty admin-error">Returns unavailable: {returns.error.message}</div> : <div className="inventory-purchase-list">{(returns.data ?? []).map((item) => <article key={item.id}><header><div><strong>{item.orderNumber} · {item.productName} · {item.size}</strong><small>{item.quantity} unit(s) · {item.status} · {item.reason}</small></div></header>{['requested', 'approved'].includes(item.status) && <form className="inventory-return-actions" onSubmit={(event) => { event.preventDefault(); void updateReturn(item, 'receive', event.currentTarget) }}><label>Resolution note<input name="note" maxLength={500} /></label>{item.status === 'requested' && <><button className="admin-it-button" type="button" disabled={busy} onClick={(event) => void updateReturn(item, 'approve', event.currentTarget.form ?? undefined)}>Approve</button><button className="admin-it-button is-danger" type="button" disabled={busy} onClick={(event) => void updateReturn(item, 'reject', event.currentTarget.form ?? undefined)}>Reject</button></>}{item.status === 'approved' && <button className="admin-it-button" type="submit" disabled={busy}>Receive and restock</button>}</form>}</article>)}{returns.isPending && <div className="admin-empty">Loading return requests…</div>}{!returns.isPending && !returns.data?.length && <div className="admin-empty">No return requests have been recorded.</div>}</div>}</section>
  </>
}

function InventoryAnalyticsPanel() {
  const products = useQuery({ queryKey: ['inventory-products'], queryFn: () => roleApi<InventoryProduct[]>('/api/v1/admin/products'), retry: false })
  const movements = useQuery({ queryKey: ['inventory-movements'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/inventory/movements'), retry: false })
  const stockRows = (products.data ?? []).flatMap((product) => (product.variants ?? []).map((variant) => ({ product: product.name, stock: variant.stock })))
  const low = stockRows.filter((row) => row.stock > 0 && row.stock <= 5).length
  const out = stockRows.filter((row) => row.stock === 0).length
  return <section className="inventory-panel"><header><div><span className="admin-kicker">STOCK AND MOVEMENT SUMMARY</span><h2>Inventory analytics</h2></div><BarChart3 size={19} /></header><div className="inventory-report-grid">{[['Products', products.data?.length ?? '—'], ['Tracked variants', stockRows.length], ['Units in stock', stockRows.reduce((total, row) => total + row.stock, 0)], ['Low stock', low], ['Out of stock', out], ['Movement records', movements.data?.length ?? '—']].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{String(value)}</strong></article>)}</div><p className="inventory-panel-copy">Cost valuation is not shown because product cost data is not consistently configured.</p></section>
}

function InventorySettingsPanel() {
  return <section className="inventory-panel"><header><div><span className="admin-kicker">SERVER-ENFORCED OPERATIONS</span><h2>Inventory settings</h2></div><Boxes size={19} /></header><div className="inventory-alert-list"><p>Low stock is reported at five units or fewer.</p><p>Return requests are limited to delivered orders within 30 days.</p><p>Stock changes, purchase-order receipts, and accepted returns are recorded as movements.</p><p>Supplier purchasing and return eligibility are validated by the server.</p></div></section>
}

function InventoryAlertsPanel() {
  const products = useQuery({ queryKey: ['inventory-products'], queryFn: () => roleApi<InventoryProduct[]>('/api/v1/admin/products'), retry: false })
  const rows = (products.data ?? []).flatMap((product) => (product.variants ?? []).map((variant) => ({ product: product.name, size: variant.size, sku: variant.sku, stock: variant.stock })))
  const alerts = rows.filter((row) => row.stock <= 5).sort((left, right) => left.stock - right.stock)
  return <section className="inventory-panel"><header><div><span className="admin-kicker">STOCK EXCEPTIONS</span><h2>Inventory notifications</h2></div><AlertTriangle size={19} /></header><p className="inventory-panel-copy">Alerts are derived from current variant stock. No notification is sent externally by this view.</p><InventoryTable rows={alerts} /></section>
}

function InventoryUnavailable({ title, detail }: { title: string; detail: string }) {
  if (title.startsWith('Suppliers')) return <InventorySuppliersPanel />
  if (title.startsWith('Purchase Orders')) return <InventoryPurchaseOrdersPanel />
  if (title.startsWith('Goods Receiving')) return <InventoryPurchaseOrdersPanel mode="receiving" />
  if (title.startsWith('Returns')) return <InventoryReturnsPanel />
  if (title.startsWith('Analytics') || title.startsWith('Reports')) return <InventoryAnalyticsPanel />
  if (title.startsWith('Settings')) return <InventorySettingsPanel />
  if (title.startsWith('Notifications')) return <InventoryAlertsPanel />
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
  return <main className="admin-it-page super-admin-page role-portal-shell inventory-portal-shell"><aside className="super-admin-sidebar role-portal-sidebar"><Link to="/" className="admin-brand" aria-label="MATRIX home"><img src="/matrix-logo.png" alt="MATRIX" /></Link><strong>{config.title}</strong><nav>{config.modules.map((module) => <button type="button" key={module} className={activeModule === module ? 'active' : ''} onClick={() => { setActiveModule(module); setError(''); setNotice('') }}>{module}</button>)}</nav><button type="button" className="admin-it-button role-portal-signout" onClick={() => void signOutRolePortal(navigate, prefix)}>Sign out</button></aside><section className="super-admin-main role-portal-main inventory-portal-main"><header><div><span className="admin-kicker">INVENTORY CONTROL CENTRE</span><h1>{activeModule}</h1><p className="inventory-header-copy">Stock visibility, movement accountability, and fulfillment readiness for KitCulture.</p></div><Boxes size={24} /></header>{notice && <p className="inventory-notice" role="status">{notice}</p>}{error && <p className="inventory-error" role="alert">{error}</p>}{portal.isError || products.isError ? <div className="admin-empty admin-error">Inventory data is unavailable: {(portal.error ?? products.error)?.message}</div> : panel}{activeModule === 'Stock Management' && <section className="inventory-panel"><header><div><span className="admin-kicker">CONTROLLED MUTATION</span><h2>Adjust stock</h2></div><Boxes size={19} /></header><form className="inventory-adjust-form" onSubmit={(event) => void adjustStock(event)}><label>Variant<select value={selectedVariant} onChange={(event) => setSelectedVariant(event.target.value)} required><option value="">Select product variant</option>{stockRows.map((row) => <option key={row.id} value={row.id}>{row.product} · {row.size} · current {row.stock}</option>)}</select></label><label>Quantity change<input name="delta" type="number" min="-100000" max="100000" step="1" required placeholder="Positive to receive, negative to remove" /></label><label>Reason<input name="note" required maxLength={500} placeholder="Count correction, damaged, returned, received..." /></label><button className="role-portal-button" type="submit" disabled={!selectedVariant}>Record adjustment</button></form></section>}</section></main>
}

type MarketingCampaign = { id: number; type: string; title: string; body: string; href: string | null; audienceType: string; createdAt: string; recipientCount: number; unreadCount: number | null }
type MarketingCoupon = { id: number; code: string; discountType: 'percent' | 'fixed'; value: string; minimumSubtotal: string; maxRedemptions: number | null; redemptionCount: number; active: boolean; startsAt: string | null; endsAt: string | null; createdAt: string }
type MarketingAudience = { totalCustomers: number; eligibleEmailSubscribers: number; consentRequired: boolean }
type MarketingEmailCampaign = { id: number; subject: string; body: string; status: string; recipientCount: number; acceptedCount: number; failedCount: number; createdAt: string }

function MarketingTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <div className="admin-empty">No marketing records are available.</div>
  const columns = Object.keys(rows[0]).slice(0, 7)
  return <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/([A-Z])/g, ' $1')}</th>)}</tr></thead><tbody>{rows.slice(0, 50).map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? '—' : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column])}</td>)}</tr>)}</tbody></table></div>
}

function MarketingUnavailable({ title, detail }: { title: string; detail: string }) {
  return <section className="marketing-panel marketing-unavailable"><AlertTriangle size={22} /><span className="admin-kicker">CONTROL NOT CONNECTED</span><h2>{title}</h2><p>{detail}</p></section>
}

function MarketingCouponsPanel() {
  const coupons = useQuery({ queryKey: ['marketing-coupons'], queryFn: () => roleApi<MarketingCoupon[]>('/api/v1/admin/marketing/coupons'), retry: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function createCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const maxRedemptions = String(form.get('maxRedemptions') ?? '').trim()
      const startsAt = String(form.get('startsAt') ?? '').trim()
      const endsAt = String(form.get('endsAt') ?? '').trim()
      await roleApi('/api/v1/admin/marketing/coupons', { method: 'POST', body: JSON.stringify({
        code: form.get('code'), discountType: form.get('discountType'), value: form.get('value'),
        minimumSubtotal: form.get('minimumSubtotal') || '0.00',
        maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      }) })
      formElement.reset()
      setNotice('Coupon created and available for checkout.')
      await coupons.refetch()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Coupon could not be created.')
    } finally {
      setBusy(false)
    }
  }

  async function setActive(coupon: MarketingCoupon) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await roleApi(`/api/v1/admin/marketing/coupons/${coupon.id}`, { method: 'PATCH', body: JSON.stringify({ active: !coupon.active }) })
      setNotice(`Coupon ${coupon.code} ${coupon.active ? 'deactivated' : 'activated'}.`)
      await coupons.refetch()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Coupon status could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <section className="marketing-panel"><header><div><span className="admin-kicker">CHECKOUT DISCOUNTS</span><h2>Create coupon</h2></div><Receipt size={19} /></header>
      <form className="marketing-campaign-form" onSubmit={(event) => void createCoupon(event)}>
        <label>Coupon code<input name="code" required minLength={3} maxLength={40} pattern="[A-Za-z0-9_-]+" autoCapitalize="characters" /></label>
        <label>Discount type<select name="discountType" defaultValue="percent"><option value="percent">Percentage</option><option value="fixed">Fixed amount (KES)</option></select></label>
        <label>Discount value<input name="value" type="number" min="0.01" max="100" step="0.01" required /></label>
        <label>Minimum subtotal (KES)<input name="minimumSubtotal" type="number" min="0" step="0.01" defaultValue="0" required /></label>
        <label>Maximum redemptions<input name="maxRedemptions" type="number" min="1" step="1" placeholder="No limit" /></label>
        <label>Starts at<input name="startsAt" type="datetime-local" /></label>
        <label>Ends at<input name="endsAt" type="datetime-local" /></label>
        {error && <p className="marketing-error" role="alert">{error}</p>}{notice && <p className="marketing-notice" role="status">{notice}</p>}
        <button className="role-portal-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create coupon'}</button>
      </form>
    </section>
    <section className="marketing-panel"><header><div><span className="admin-kicker">LIVE CHECKOUT CODES</span><h2>Coupons</h2></div><ShoppingBag size={19} /></header>
      {coupons.isError ? <div className="admin-empty admin-error">Coupons unavailable: {coupons.error.message}</div> : <div className="marketing-coupon-list">{(coupons.data ?? []).map((coupon) => <article key={coupon.id}><div><strong>{coupon.code}</strong><small>{coupon.discountType === 'percent' ? `${coupon.value}%` : `KES ${coupon.value}`} · {coupon.redemptionCount}{coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ''} redeemed</small><small>{coupon.endsAt ? `Ends ${new Date(coupon.endsAt).toLocaleString()}` : 'No expiry set'}</small></div><span className={coupon.active ? 'is-active' : ''}>{coupon.active ? 'Active' : 'Inactive'}</span><button type="button" className="admin-it-button" disabled={busy} onClick={() => void setActive(coupon)}>{coupon.active ? 'Deactivate' : 'Activate'}</button></article>)}{coupons.isPending && <div className="admin-empty">Loading coupons…</div>}{!coupons.isPending && !coupons.data?.length && <div className="admin-empty">No coupons have been created.</div>}</div>}
    </section>
  </>
}

function MarketingAudiencesPanel() {
  const audience = useQuery({ queryKey: ['marketing-audiences'], queryFn: () => roleApi<MarketingAudience>('/api/v1/admin/marketing/audiences'), retry: false })
  if (audience.isPending) return <div className="admin-empty">Loading consent-qualified audience totals…</div>
  if (audience.isError || !audience.data) return <div className="admin-empty admin-error">Audience data unavailable: {audience.error?.message}</div>
  return <section className="marketing-panel"><header><div><span className="admin-kicker">CONSENT-AWARE REACH</span><h2>Audience overview</h2></div><Users size={19} /></header><div className="marketing-kpi-grid"><article><span>Customer accounts</span><strong>{audience.data.totalCustomers.toLocaleString()}</strong></article><article><span>Verified email subscribers</span><strong>{audience.data.eligibleEmailSubscribers.toLocaleString()}</strong></article></div><p className="marketing-panel-copy">Email campaigns include only verified customers with an active marketing-consent record. Individual subscriber details are not exposed in this view.</p></section>
}

function MarketingEmailPanel() {
  const queryClient = useQueryClient()
  const emails = useQuery({ queryKey: ['marketing-email-campaigns'], queryFn: () => roleApi<MarketingEmailCampaign[]>('/api/v1/admin/marketing/email-campaigns'), retry: false })
  const audience = useQuery({ queryKey: ['marketing-audiences'], queryFn: () => roleApi<MarketingAudience>('/api/v1/admin/marketing/audiences'), retry: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function sendEmailCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await roleApi<{ recipientCount: number; acceptedCount: number; failedCount: number; status: string }>('/api/v1/admin/marketing/email-campaigns', { method: 'POST', body: JSON.stringify({ subject: form.get('subject'), body: form.get('body') }) })
      formElement.reset()
      setNotice(`Delivery ${result.status}: ${result.acceptedCount} accepted, ${result.failedCount} failed of ${result.recipientCount} opted-in subscribers.`)
      await Promise.all([emails.refetch(), queryClient.invalidateQueries({ queryKey: ['marketing-portal'] })])
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Email campaign could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <section className="marketing-panel"><header><div><span className="admin-kicker">OPTED-IN CUSTOMERS ONLY</span><h2>Create email campaign</h2></div><Mail size={19} /></header>
      <p className="marketing-panel-copy">The backend sends only to verified customers with marketing consent, includes a preferences link, and limits each send to 250 recipients.</p>
      {audience.data && <p className="marketing-panel-copy">Current eligible audience: {audience.data.eligibleEmailSubscribers.toLocaleString()} subscribers. Sending is available only when the configured email provider is ready.</p>}
      <form className="marketing-campaign-form" onSubmit={(event) => void sendEmailCampaign(event)}><label>Subject<input name="subject" required minLength={3} maxLength={160} /></label><label>Email body<textarea name="body" required minLength={10} maxLength={6000} rows={7} /></label>{error && <p className="marketing-error" role="alert">{error}</p>}{notice && <p className="marketing-notice" role="status">{notice}</p>}<button className="role-portal-button" type="submit" disabled={busy || !audience.data?.eligibleEmailSubscribers}>{busy ? 'Sending…' : 'Send to opted-in subscribers'}</button></form>
    </section>
    <section className="marketing-panel"><header><div><span className="admin-kicker">CAMPAIGN OUTCOMES</span><h2>Email history</h2></div><FileText size={19} /></header>{emails.isError ? <div className="admin-empty admin-error">Email campaign history unavailable: {emails.error.message}</div> : <MarketingTable rows={(emails.data ?? []) as unknown as Record<string, unknown>[]} />}</section>
  </>
}

function MarketingWorkspace({ prefix }: { prefix: keyof typeof roleConfig }) {
  const navigate = useNavigate()
  const [activeModule, setActiveModule] = useState('Dashboard')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const config = roleConfig[prefix]
  const portal = useQuery({ queryKey: ['marketing-portal'], queryFn: () => roleApi<PortalData>('/api/v1/admin/portal/marketing_admin'), retry: false })
  const campaigns = useQuery({ queryKey: ['marketing-campaigns'], queryFn: () => roleApi<MarketingCampaign[]>('/api/v1/admin/notifications'), enabled: ['Dashboard', 'Campaigns', 'Notifications', 'Content Promotion', 'Analytics', 'Reports'].includes(activeModule), retry: false })
  const audit = useQuery({ queryKey: ['marketing-audit'], queryFn: () => roleApi<Record<string, unknown>[]>('/api/v1/admin/audit'), enabled: activeModule === 'Audit Logs', retry: false })
  const dashboardCoupons = useQuery({ queryKey: ['marketing-coupons'], queryFn: () => roleApi<MarketingCoupon[]>('/api/v1/admin/marketing/coupons'), enabled: activeModule === 'Dashboard' || activeModule === 'Analytics' || activeModule === 'Reports', retry: false })
  const dashboardAudience = useQuery({ queryKey: ['marketing-audiences'], queryFn: () => roleApi<MarketingAudience>('/api/v1/admin/marketing/audiences'), enabled: activeModule === 'Dashboard' || activeModule === 'Analytics' || activeModule === 'Reports', retry: false })
  const dashboardEmails = useQuery({ queryKey: ['marketing-email-campaigns'], queryFn: () => roleApi<MarketingEmailCampaign[]>('/api/v1/admin/marketing/email-campaigns'), enabled: activeModule === 'Dashboard' || activeModule === 'Analytics' || activeModule === 'Reports', retry: false })
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

  const acceptedEmails = (dashboardEmails.data ?? []).reduce((total, campaign) => total + campaign.acceptedCount, 0)
  const panel = activeModule === 'Dashboard' ? <>
    <div className="marketing-kpi-grid">{[['Campaigns', campaignRows.length], ['Recipients reached', totalRecipients], ['Unread responses', totalUnread], ['Active coupons', (dashboardCoupons.data ?? []).filter((coupon) => coupon.active).length], ['Email deliveries accepted', acceptedEmails], ['Opted-in subscribers', dashboardAudience.data?.eligibleEmailSubscribers ?? '—']].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{String(value)}</strong></article>)}</div>
    <div className="marketing-panel-grid"><section className="marketing-panel"><header><div><span className="admin-kicker">CAMPAIGN ACTIVITY</span><h2>Recent campaign reach</h2></div><Megaphone size={19} /></header><div className="marketing-bars">{campaignRows.slice(0, 6).map((campaign) => <div key={campaign.id}><span>{campaign.title}</span><i><b style={{ width: `${Math.max(4, Number(campaign.recipientCount) / Math.max(1, totalRecipients) * 100)}%` }} /></i><strong>{campaign.recipientCount}</strong></div>)}</div>{!campaignRows.length && <div className="admin-empty">No notification campaigns have been sent.</div>}</section><section className="marketing-panel"><header><div><span className="admin-kicker">ANALYTICS COVERAGE</span><h2>What is measurable</h2></div><BarChart3 size={19} /></header><div className="marketing-coverage"><p>Customer delivery and unread counts are available.</p><p>Open, click, conversion, and revenue attribution tracking is unavailable.</p></div></section></div>
    <section className="marketing-panel"><header><div><span className="admin-kicker">RECENT CAMPAIGNS</span><h2>Campaign history</h2></div><ShoppingBag size={19} /></header><MarketingTable rows={campaignRows as unknown as Record<string, unknown>[]} /></section>
  </> : activeModule === 'Campaigns' || activeModule === 'Notifications' || activeModule === 'Content Promotion' ? <><section className="marketing-panel"><header><div><span className="admin-kicker">IN-APP CUSTOMER COMMUNICATION</span><h2>{activeModule === 'Content Promotion' ? 'Promote a page or offer' : activeModule === 'Campaigns' ? 'Create campaign' : 'Compose notification'}</h2></div><Megaphone size={19} /></header><p className="marketing-panel-copy">Notifications are sent immediately to all customer accounts. Use a same-site destination for the page or offer. Email consent and scheduling are handled separately.</p><form className="marketing-campaign-form" onSubmit={(event) => void createCampaign(event)}><label>Campaign title<input name="title" required minLength={2} maxLength={160} /></label><label>Message<textarea name="body" required minLength={2} maxLength={2000} rows={4} /></label><label>In-app destination (optional)<input name="href" maxLength={320} placeholder="/account/marketplace" /></label>{error && <p className="marketing-error" role="alert">{error}</p>}{notice && <p className="marketing-notice" role="status">{notice}</p>}<button className="role-portal-button" type="submit">Send to customers</button></form></section><section className="marketing-panel"><header><div><span className="admin-kicker">DELIVERY HISTORY</span><h2>Sent campaigns</h2></div><FileText size={19} /></header><MarketingTable rows={campaignRows as unknown as Record<string, unknown>[]} /></section></>
    : activeModule === 'Promotions' || activeModule === 'Coupons' ? <MarketingCouponsPanel />
      : activeModule === 'Audiences' ? <MarketingAudiencesPanel />
        : activeModule === 'Email Marketing' ? <MarketingEmailPanel />
          : activeModule === 'Analytics' ? <><div className="marketing-kpi-grid">{[['In-app campaigns', campaignRows.length], ['Notification recipients', totalRecipients], ['Unread notifications', totalUnread], ['Active coupons', (dashboardCoupons.data ?? []).filter((coupon) => coupon.active).length], ['Accepted email deliveries', acceptedEmails], ['Verified opted-in subscribers', dashboardAudience.data?.eligibleEmailSubscribers ?? '—']].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{String(value)}</strong></article>)}</div><section className="marketing-panel"><header><div><span className="admin-kicker">MEASUREMENT LIMITS</span><h2>Available analytics</h2></div><BarChart3 size={19} /></header><p className="marketing-panel-copy">Delivery acceptance and in-app unread counts are recorded. Open rates, clicks, coupon-attributed orders, and revenue attribution are not tracked by the current backend.</p><MarketingTable rows={campaignRows as unknown as Record<string, unknown>[]} /></section></>
            : activeModule === 'Reports' ? <><section className="marketing-panel"><header><div><span className="admin-kicker">CAMPAIGN REPORT</span><h2>Notification outcomes</h2></div><FileText size={19} /></header><MarketingTable rows={campaignRows as unknown as Record<string, unknown>[]} /></section><section className="marketing-panel"><header><div><span className="admin-kicker">EMAIL REPORT</span><h2>Accepted and failed deliveries</h2></div><Mail size={19} /></header><MarketingTable rows={(dashboardEmails.data ?? []) as unknown as Record<string, unknown>[]} /></section></>
              : activeModule === 'Settings' ? <section className="marketing-panel"><header><div><span className="admin-kicker">SERVER-ENFORCED POLICY</span><h2>Marketing settings</h2></div><Check size={19} /></header><div className="marketing-coverage"><p>Email sends require a verified address and recorded marketing consent.</p><p>Each email send is limited to 250 recipients and includes a preferences link.</p><p>In-app notifications send immediately to all customer accounts; they are not scheduled.</p><p>Email provider credentials and sender configuration are managed in the server environment, not this browser.</p></div></section>
                : activeModule === 'Audit Logs' ? <section className="marketing-panel"><header><div><span className="admin-kicker">MARKETING ACCOUNTABILITY</span><h2>Audit logs</h2></div><FileText size={19} /></header><MarketingTable rows={audit.data ?? []} /></section> : <MarketingUnavailable title={`${activeModule} is not available`} detail="This module is not exposed by the current server contract." />
  return <main className="admin-it-page super-admin-page role-portal-shell marketing-portal-shell"><aside className="super-admin-sidebar role-portal-sidebar"><Link to="/" className="admin-brand" aria-label="MATRIX home"><img src="/matrix-logo.png" alt="MATRIX" /></Link><strong>{config.title}</strong><nav>{config.modules.map((module) => <button type="button" key={module} className={activeModule === module ? 'active' : ''} onClick={() => { setActiveModule(module); setError(''); setNotice('') }}>{module}</button>)}</nav><button type="button" className="admin-it-button role-portal-signout" onClick={() => void signOutRolePortal(navigate, prefix)}>Sign out</button></aside><section className="super-admin-main role-portal-main marketing-portal-main"><header><div><span className="admin-kicker">MARKETING MANAGEMENT CENTRE</span><h1>{activeModule}</h1><p className="marketing-header-copy">Campaign communication and measurable customer engagement for KitCulture.</p></div><Megaphone size={24} /></header>{portal.isError ? <div className="admin-empty admin-error">Marketing data is unavailable: {portal.error.message}</div> : panel}</section></main>
}

type LaundryAdminBooking = {
  id: number
  reference: string
  name: string
  phone: string
  location: string
  locationLatitude: string | null
  locationLongitude: string | null
  serviceName: string | null
  quantity: string | null
  quantityUnit: string | null
  pickupAddress: string | null
  preferredPickupAt: string | null
  deliveryAddress: string | null
  preferredDeliveryAt: string | null
  amountDue: string
  amountPaid: string
  balance: string
  paymentStatus: 'PAID' | 'UNPAID' | 'PENDING'
  latestPaymentMethod: string | null
  latestPaymentDate: string | null
  status: string
  createdAt: string
}

type LaundryPayment = {
  id: number
  bookingId: number
  amount: string
  method: 'cash' | 'mpesa' | 'bank_transfer' | 'other'
  paymentDate: string
  transactionReference: string | null
  notes: string | null
  status: 'pending' | 'confirmed' | 'reversed'
  recordedByAdminId: number
  createdAt: string
}

type LaundryBookingDetails = LaundryAdminBooking & { payments: LaundryPayment[]; events: { id: number; previousStatus: string | null; newStatus: string; note: string | null; createdAt: string }[] }
type LaundryDashboardData = Record<string, number | string | { date: string; amount: string }[]>
type LaundryLocation = { id: number; name: string; active: boolean; sortOrder: number }
type LaundryCustomer = { name: string; phone: string; totalBookings: number; completedBookings: number; amountDue: string; amountPaid: string; balance: string; lastBookingAt: string }

function LaundryOperationsPanel({ mode }: { mode: 'pickups' | 'processing' | 'deliveries' }) {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const params = new URLSearchParams({ page: String(page), limit: '50' })
  if (search.trim()) params.set('search', search.trim())
  if (from) params.set('from', from)
  if (to) params.set('to', to)

  const queue = useQuery({
    queryKey: ['laundry-queue', mode, params.toString()],
    queryFn: () => roleApiPage<LaundryAdminBooking[]>(`/api/v1/admin/laundry/${mode}?${params}`),
    retry: false,
  })

  return <section className="finance-panel">
    <header><div><span className="admin-kicker">{mode.toUpperCase()} WORKFLOW</span><h2>{mode === 'pickups' ? 'Pickup queue' : mode === 'processing' ? 'Processing queue' : 'Delivery queue'}</h2></div>{mode === 'pickups' ? <CalendarDays size={19} /> : mode === 'processing' ? <Clock3 size={19} /> : <MapPin size={19} />}</header>
    <div className="laundry-filter-row">
      <label>Search reference, customer or phone<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
      <label>From date<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} /></label>
      <label>To date<input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} /></label>
    </div>
    {queue.isError ? <div className="admin-empty admin-error">Queue unavailable: {queue.error.message}</div> : <>
      <LaundryBookingTable rows={queue.data?.data ?? []} onOpen={(id) => navigate(`/laundry-admin/bookings/${id}`)} />
      {queue.data && <div className="laundry-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} · {queue.data.pagination.total} records</span><button type="button" disabled={page * queue.data.pagination.limit >= queue.data.pagination.total} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
    </>}
  </section>
}

function LaundryCustomersPanel() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const params = new URLSearchParams({ page: String(page), limit: '25' })
  if (search.trim()) params.set('search', search.trim())

  const customers = useQuery({
    queryKey: ['laundry-customers', params.toString()],
    queryFn: () => roleApiPage<LaundryCustomer[]>(`/api/v1/admin/laundry/customers?${params}`),
    retry: false,
  })

  return <section className="finance-panel">
    <header><div><span className="admin-kicker">CUSTOMER RECORDS</span><h2>Laundry customers</h2></div><Users size={19} /></header>
    <div className="laundry-filter-row">
      <label>Search name or phone<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
    </div>
    {customers.isError ? <div className="admin-empty admin-error">Customer records unavailable: {customers.error.message}</div> : <>
      <div className="admin-it-table-wrap"><table className="admin-it-table laundry-admin-table"><thead><tr><th>Name</th><th>Phone</th><th>Bookings</th><th>Completed</th><th>Due</th><th>Paid</th><th>Balance</th><th>Last visit</th></tr></thead><tbody>{(customers.data?.data ?? []).map((customer) => <tr key={customer.phone}><td>{customer.name}</td><td>{customer.phone}</td><td>{customer.totalBookings}</td><td>{customer.completedBookings}</td><td>{currency(customer.amountDue)}</td><td>{currency(customer.amountPaid)}</td><td>{currency(customer.balance)}</td><td>{customer.lastBookingAt ? new Date(customer.lastBookingAt).toLocaleDateString() : '—'}</td></tr>)}</tbody></table></div>
      {customers.data && <div className="laundry-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} · {customers.data.pagination.total} customers</span><button type="button" disabled={page * customers.data.pagination.limit >= customers.data.pagination.total} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
      {!customers.data?.data.length && <div className="admin-empty">No customer records match this search.</div>}
    </>}
  </section>
}

const laundryNavigation = [
  { label: 'Dashboard', path: '/laundry-admin/dashboard' },
  { label: 'Bookings', path: '/laundry-admin/bookings' },
  { label: 'Pickups', path: '/laundry-admin/pickups' },
  { label: 'Processing', path: '/laundry-admin/processing' },
  { label: 'Deliveries', path: '/laundry-admin/deliveries' },
  { label: 'Customers', path: '/laundry-admin/customers' },
  { label: 'Payments', path: '/laundry-admin/payments' },
  { label: 'Pickup Locations', path: '/laundry-admin/locations' },
]

function LaundryAdminUnavailableWorkspace() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const route = location.pathname
  const bookingDetail = /^\/laundry-admin\/bookings\/(\d+)$/.exec(route)
  const activePath = bookingDetail ? '/laundry-admin/bookings' : route
  const activeLabel = laundryNavigation.find((item) => item.path === activePath)?.label ?? 'Dashboard'
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [page, setPage] = useState(1)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const params = new URLSearchParams({ page: String(page), limit: '25' })
  if ((activeLabel === 'Bookings' || activeLabel === 'Payments') && search.trim()) params.set('search', search.trim())
  if (activeLabel === 'Bookings' && statusFilter) params.set('status', statusFilter)
  if (activeLabel === 'Payments') {
    if (paymentFilter) params.set('status', paymentFilter)
    if (methodFilter) params.set('method', methodFilter)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
  }
  const dashboardParams = new URLSearchParams()
  if (from) dashboardParams.set('from', from)
  if (to) dashboardParams.set('to', to)
  const dashboard = useQuery({ queryKey: ['laundry-dashboard', from, to], queryFn: () => roleApi<LaundryDashboardData>(`/api/v1/admin/laundry/dashboard${dashboardParams.size ? `?${dashboardParams}` : ''}`), enabled: activeLabel === 'Dashboard', retry: false })
  const bookings = useQuery({ queryKey: ['laundry-bookings', params.toString()], queryFn: () => roleApiPage<LaundryAdminBooking[]>(`/api/v1/admin/laundry/bookings?${params}`), enabled: activeLabel === 'Bookings' || activeLabel === 'Payments' || activeLabel === 'Dashboard', retry: false })
  const detail = useQuery({ queryKey: ['laundry-booking', bookingDetail?.[1]], queryFn: () => roleApi<LaundryBookingDetails>(`/api/v1/admin/laundry/bookings/${bookingDetail?.[1]}`), enabled: Boolean(bookingDetail), retry: false })
  const locations = useQuery({ queryKey: ['laundry-locations'], queryFn: () => roleApi<LaundryLocation[]>('/api/v1/admin/laundry/locations'), enabled: activeLabel === 'Pickup Locations', retry: false })
  const [locationText, setLocationText] = useState<string | null>(null)

  async function refreshLaundryData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['laundry-dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['laundry-bookings'] }),
      queryClient.invalidateQueries({ queryKey: ['laundry-booking'] }),
      queryClient.invalidateQueries({ queryKey: ['laundry-locations'] }),
    ])
  }

  async function updateBooking(id: number, body: Record<string, unknown>, successMessage: string) {
    setError(''); setNotice('')
    try {
      await roleApi(`/api/v1/admin/laundry/bookings/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      setNotice(successMessage)
      await refreshLaundryData()
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Booking could not be updated.') }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>, booking: LaundryBookingDetails) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setError(''); setNotice('')
    try {
      await roleApi(`/api/v1/admin/laundry/bookings/${booking.id}/payments`, { method: 'POST', body: JSON.stringify({
        amount: form.get('amount'), method: form.get('method'), paymentDate: form.get('paymentDate'),
        transactionReference: form.get('transactionReference') || undefined, notes: form.get('notes') || undefined,
        status: form.get('status'), idempotencyKey: crypto.randomUUID(),
      }) })
      formElement.reset()
      setNotice('Customer payment recorded.')
      await refreshLaundryData()
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Payment could not be recorded.') }
  }

  async function updatePayment(event: FormEvent<HTMLFormElement>, paymentId: number) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError(''); setNotice('')
    try {
      await roleApi(`/api/v1/admin/laundry/payments/${paymentId}`, { method: 'PATCH', body: JSON.stringify({ amount: form.get('amount'), method: form.get('method'), paymentDate: form.get('paymentDate'), transactionReference: form.get('transactionReference') || null, notes: form.get('notes') || null, status: form.get('status') }) })
      setNotice('Payment correction saved in the audit history.')
      await refreshLaundryData()
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Payment could not be updated.') }
  }

  async function saveLocations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = (locationText ?? (locations.data ?? []).filter((item) => item.active).map((item) => item.name).join('\n')).split('\n').map((item) => item.trim()).filter(Boolean)
    setError(''); setNotice('')
    try {
      await roleApi('/api/v1/admin/laundry/locations', { method: 'PUT', body: JSON.stringify({ locations: values }) })
      setNotice('Pickup locations saved.')
      await refreshLaundryData()
      setLocationText(null)
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Pickup locations could not be saved.') }
  }

  const dashboardMetrics = dashboard.data ? [
    ['Total Bookings', dashboard.data.totalBookings], ['New Requests', dashboard.data.newRequests], ['Confirmed', dashboard.data.confirmedBookings],
    ['Revenue Received', currency(String(dashboard.data.totalRevenueReceived))], ['Total Amount Due', currency(String(dashboard.data.totalAmountDue))],
    ['Outstanding Balance', currency(String(dashboard.data.totalOutstandingBalance))], ['Paid Bookings', dashboard.data.paidBookings],
    ['Unpaid Bookings', dashboard.data.unpaidBookings], ['Pending Payments', dashboard.data.pendingPayments],
    ['Transactions', dashboard.data.totalTransactions], ['Received Today', currency(String(dashboard.data.paymentsReceivedToday))],
    ['Received This Month', currency(String(dashboard.data.paymentsReceivedThisMonth))],
  ] : []
  const collectionRows = Array.isArray(dashboard.data?.collections) ? dashboard.data.collections as { date: string; amount: string }[] : []
  const maxCollection = Math.max(1, ...collectionRows.map((row) => Number(row.amount)))
  const listRows = bookings.data?.data ?? []

  const panel = activeLabel === 'Pickups' ? <LaundryOperationsPanel mode="pickups" />
    : activeLabel === 'Processing' ? <LaundryOperationsPanel mode="processing" />
      : activeLabel === 'Deliveries' ? <LaundryOperationsPanel mode="deliveries" />
        : activeLabel === 'Customers' ? <LaundryCustomersPanel />
          : bookingDetail ? <>
    {detail.isPending ? <div className="admin-empty">Loading booking details…</div> : detail.isError ? <div className="admin-empty admin-error">Booking details unavailable: {detail.error.message}</div> : detail.data && <>
      <section className="finance-panel"><header><div><span className="admin-kicker">BOOKING RECORD</span><h2>{detail.data.reference}</h2></div><span className={`laundry-payment-status ${detail.data.paymentStatus.toLowerCase()}`}>{detail.data.paymentStatus}</span></header>
        <div className="laundry-detail-grid"><div><span>Customer</span><strong>{detail.data.name}</strong></div><div><span>Phone</span><strong>{detail.data.phone}</strong></div><div><span>Pickup location</span><strong>{detail.data.location}</strong></div><div><span>Booking status</span><strong>{detail.data.status.replaceAll('_', ' ')}</strong></div><div><span>Amount due</span><strong>{currency(detail.data.amountDue)}</strong></div><div><span>Amount paid</span><strong>{currency(detail.data.amountPaid)}</strong></div><div><span>Outstanding balance</span><strong>{currency(detail.data.balance)}</strong></div><div><span>Created</span><strong>{new Date(detail.data.createdAt).toLocaleString()}</strong></div></div>
        {(detail.data.locationLatitude && detail.data.locationLongitude) && <a className="laundry-inline-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${detail.data.locationLatitude},${detail.data.locationLongitude}`)}`} target="_blank" rel="noreferrer">Open pinned pickup in Google Maps</a>}
      </section>
      <section className="finance-panel"><header><div><span className="admin-kicker">BOOKING CONTROL</span><h2>Update booking</h2></div><CalendarDays size={19} /></header><form className="laundry-admin-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void updateBooking(detail.data!.id, { status: data.get('status'), amountDue: data.get('amountDue'), pickupAddress: data.get('pickupAddress') || null, preferredPickupAt: data.get('preferredPickupAt') ? new Date(String(data.get('preferredPickupAt'))).toISOString() : null, note: data.get('note') || undefined }, 'Booking updated.') }}><label>Status<select name="status" defaultValue={detail.data.status}><option value="new">New request</option><option value="confirmed">Confirmed</option><option value="pickup_scheduled">Pickup scheduled</option><option value="collected">Collected</option><option value="washing">Washing</option><option value="drying">Drying</option><option value="ironing_folding">Ironing and folding</option><option value="ready_for_delivery">Ready for delivery</option><option value="out_for_delivery">Out for delivery</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label><label>Total amount due (KES)<input name="amountDue" type="number" min="0" step="0.01" required defaultValue={detail.data.amountDue} /></label><label>Pickup address (optional)<input name="pickupAddress" maxLength={500} defaultValue={detail.data.pickupAddress ?? ''} /></label><label>Pickup date and time<input name="preferredPickupAt" type="datetime-local" defaultValue={detail.data.preferredPickupAt ? new Date(detail.data.preferredPickupAt).toISOString().slice(0, 16) : ''} /></label><label>Internal status note<input name="note" maxLength={500} /></label><button className="role-portal-button" type="submit">Save booking</button></form></section>
      <section className="finance-panel"><header><div><span className="admin-kicker">MANUAL CUSTOMER PAYMENT</span><h2>Record Customer Payment</h2></div><Receipt size={19} /></header><form className="laundry-admin-form" onSubmit={(event) => void recordPayment(event, detail.data!)}><label>Amount received (KES)<input name="amount" type="number" min="0.01" step="0.01" required max={detail.data.balance} /></label><label>Payment method<select name="method" defaultValue="cash"><option value="cash">Cash</option><option value="mpesa">M-Pesa (manual)</option><option value="bank_transfer">Bank Transfer</option><option value="other">Other</option></select></label><label>Payment date<input name="paymentDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>Payment status<select name="status" defaultValue="confirmed"><option value="confirmed">Confirmed received</option><option value="pending">Pending confirmation</option></select></label><label>Transaction reference (optional)<input name="transactionReference" maxLength={120} /></label><label>Notes (optional)<input name="notes" maxLength={1000} /></label><button className="role-portal-button" type="submit" disabled={Number(detail.data.balance) <= 0}>Save Payment</button></form></section>
      <section className="finance-panel"><header><div><span className="admin-kicker">IMMUTABLE HISTORY</span><h2>Payment history</h2></div><FileText size={19} /></header>{detail.data.payments.length ? <div className="laundry-record-list">{detail.data.payments.map((payment) => <article key={payment.id}><div><strong>{currency(payment.amount)} · {payment.method.replaceAll('_', ' ')}</strong><span className={`laundry-payment-status ${payment.status}`}>{payment.status}</span><small>{new Date(payment.paymentDate).toLocaleDateString()} · {payment.transactionReference || 'No transaction reference'} · Recorded by admin {payment.recordedByAdminId}</small>{payment.notes && <small>{payment.notes}</small>}</div><details><summary>Correct record</summary><form className="laundry-admin-form" onSubmit={(event) => void updatePayment(event, payment.id)}><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={payment.amount} /></label><label>Method<select name="method" defaultValue={payment.method}><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="bank_transfer">Bank Transfer</option><option value="other">Other</option></select></label><label>Date<input name="paymentDate" type="date" required defaultValue={payment.paymentDate.slice(0, 10)} /></label><label>Status<select name="status" defaultValue={payment.status}><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="reversed">Reverse payment</option></select></label><label>Reference<input name="transactionReference" defaultValue={payment.transactionReference ?? ''} maxLength={120} /></label><label>Notes<input name="notes" defaultValue={payment.notes ?? ''} maxLength={1000} /></label><button className="role-portal-button" type="submit">Save correction</button></form></details></article>)}</div> : <div className="admin-empty">No payments recorded for this booking.</div>}</section>
      <section className="finance-panel"><header><div><span className="admin-kicker">BOOKING HISTORY</span><h2>Status events</h2></div><Clock3 size={19} /></header>{detail.data.events.length ? <div className="laundry-record-list">{detail.data.events.map((event) => <article key={event.id}><strong>{event.previousStatus ? `${event.previousStatus.replaceAll('_', ' ')} → ` : ''}{event.newStatus.replaceAll('_', ' ')}</strong><small>{new Date(event.createdAt).toLocaleString()}{event.note ? ` · ${event.note}` : ''}</small></article>)}</div> : <div className="admin-empty">No status history is available.</div>}</section>
    </>}
  </> : activeLabel === 'Dashboard' ? <>
    <section className="finance-panel"><header><div><span className="admin-kicker">LIVE DATABASE TOTALS</span><h2>Business overview</h2></div><Shirt size={19} /></header><form className="laundry-date-filter" onSubmit={(event) => { event.preventDefault(); void dashboard.refetch() }}><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></form>{dashboard.isPending ? <div className="admin-empty">Loading live totals…</div> : dashboard.isError ? <div className="admin-empty admin-error">Dashboard unavailable: {dashboard.error.message}</div> : <div className="finance-kpi-grid laundry-kpi-grid">{dashboardMetrics.map(([label, value]) => <article key={String(label)}><span>{String(label)}</span><strong>{String(value)}</strong></article>)}</div>}</section>
    <section className="finance-panel"><header><div><span className="admin-kicker">CONFIRMED RECEIPTS · KES</span><h2>Collections by day</h2></div><BarChart3 size={19} /></header>{collectionRows.length ? <div className="finance-bars">{collectionRows.map((row) => <div key={row.date}><span>{row.date}</span><i><b style={{ width: `${Math.max(3, Number(row.amount) / maxCollection * 100)}%` }} /></i><strong>{Number(row.amount).toLocaleString('en-KE')}</strong></div>)}</div> : <div className="admin-empty">No confirmed payments in this date range.</div>}</section>
    <section className="finance-panel"><header><div><span className="admin-kicker">LATEST CUSTOMER REQUESTS</span><h2>Recent bookings</h2></div><ShoppingBag size={19} /></header><LaundryBookingTable rows={listRows.slice(0, 8)} onOpen={(id) => navigate(`/laundry-admin/bookings/${id}`)} /></section>
  </> : activeLabel === 'Bookings' ? <section className="finance-panel"><header><div><span className="admin-kicker">CUSTOMER PICKUP REQUESTS</span><h2>Bookings</h2></div><ShoppingBag size={19} /></header><div className="laundry-filter-row"><label>Search reference, customer or phone<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label><label>Status<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}><option value="">All statuses</option>{['new', 'confirmed', 'pickup_scheduled', 'collected', 'washing', 'drying', 'ironing_folding', 'ready_for_delivery', 'out_for_delivery', 'completed', 'cancelled'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label></div>{bookings.isError ? <div className="admin-empty admin-error">Bookings unavailable: {bookings.error.message}</div> : <LaundryBookingTable rows={listRows} onOpen={(id) => navigate(`/laundry-admin/bookings/${id}`)} />}{bookings.data && <div className="laundry-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} · {bookings.data.pagination.total} bookings</span><button type="button" disabled={page * bookings.data.pagination.limit >= bookings.data.pagination.total} onClick={() => setPage((value) => value + 1)}>Next</button></div>}</section> : activeLabel === 'Payments' ? <section className="finance-panel">
    <header><div><span className="admin-kicker">MANUAL RECEIPTS · KES</span><h2>Payments</h2></div><Receipt size={19} /></header>
    <div className="laundry-filter-row">
      <label>Search customer, phone or booking<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
      <label>Payment status<select value={paymentFilter} onChange={(event) => { setPaymentFilter(event.target.value); setPage(1) }}><option value="">All payment statuses</option><option value="PAID">Paid</option><option value="UNPAID">Unpaid</option><option value="PENDING">Pending</option></select></label>
      <label>Payment method<select value={methodFilter} onChange={(event) => { setMethodFilter(event.target.value); setPage(1) }}><option value="">All methods</option><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="bank_transfer">Bank Transfer</option><option value="other">Other</option></select></label>
      <label>From date<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} /></label>
      <label>To date<input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} /></label>
      <a className="role-portal-button laundry-export" href="/api/v1/admin/laundry/payments/export.csv">Export CSV</a>
    </div>
    {bookings.isError ? <div className="admin-empty admin-error">Payments unavailable: {bookings.error.message}</div> : <LaundryBookingTable rows={listRows} onOpen={(id) => navigate(`/laundry-admin/bookings/${id}`)} showPayments />}
  </section> : <section className="finance-panel"><header><div><span className="admin-kicker">ADMIN-MANAGED BOOKING AREAS</span><h2>Pickup Locations</h2></div><MapPin size={19} /></header>{locations.isError && <p className="marketing-error" role="alert">Locations unavailable: {locations.error.message}</p>}<form className="laundry-admin-form laundry-location-form" onSubmit={(event) => void saveLocations(event)}><label>Active locations, one per line<textarea rows={8} value={locationText ?? (locations.data ?? []).filter((item) => item.active).map((item) => item.name).join('\n')} onChange={(event) => setLocationText(event.target.value)} /></label><button className="role-portal-button" type="submit">Save pickup locations</button></form></section>

  return <main className="admin-it-page super-admin-page role-portal-shell laundry-admin-shell">
    <aside className="super-admin-sidebar role-portal-sidebar"><Link to="/" className="admin-brand" aria-label="MATRIX home"><img src="/matrix-logo.png" alt="MATRIX" /></Link><strong>Laundry Admin</strong><nav>{laundryNavigation.map((item) => <Link key={item.path} to={item.path} className={activePath === item.path ? 'active' : ''}>{item.label}</Link>)}</nav><button type="button" className="admin-it-button role-portal-signout" onClick={() => void signOutRolePortal(navigate, 'laundry-admin')}>Sign out</button></aside>
    <section className="super-admin-main role-portal-main laundry-portal-main"><header><div><span className="admin-kicker">MATRIX LAUNDRY OPERATIONS</span><h1>{bookingDetail ? 'Booking details' : activeLabel}</h1><p>Live records from the Laundry operations database.</p></div><Shirt size={24} /></header>{error && <p className="marketing-error" role="alert">{error}</p>}{notice && <p className="marketing-notice" role="status">{notice}</p>}{panel}</section>
  </main>
}

function LaundryBookingTable({ rows, onOpen, showPayments = false }: { rows: LaundryAdminBooking[]; onOpen: (id: number) => void; showPayments?: boolean }) {
  if (!rows.length) return <div className="admin-empty">No booking records match these filters.</div>
  return <div className="admin-it-table-wrap"><table className="admin-it-table laundry-admin-table"><thead><tr><th>Reference</th><th>Customer</th><th>Phone</th><th>Location</th><th>Status</th>{showPayments && <><th>Due</th><th>Paid</th><th>Balance</th><th>Payment</th><th>Method / Date</th></>}<th>Created</th><th /></tr></thead><tbody>{rows.map((booking) => <tr key={booking.id}><td><button className="laundry-table-link" type="button" onClick={() => onOpen(booking.id)}>{booking.reference}</button></td><td>{booking.name}</td><td>{booking.phone}</td><td>{booking.location}</td><td>{booking.status.replaceAll('_', ' ')}</td>{showPayments && <><td>{currency(booking.amountDue)}</td><td>{currency(booking.amountPaid)}</td><td>{currency(booking.balance)}</td><td><span className={`laundry-payment-status ${booking.paymentStatus.toLowerCase()}`}>{booking.paymentStatus}</span></td><td>{booking.latestPaymentMethod?.replaceAll('_', ' ') ?? '—'}{booking.latestPaymentDate ? ` · ${new Date(booking.latestPaymentDate).toLocaleDateString()}` : ''}</td></>}<td>{new Date(booking.createdAt).toLocaleDateString()}</td><td><button className="admin-it-button" type="button" onClick={() => onOpen(booking.id)}>View</button></td></tr>)}</tbody></table></div>
}

export function RolePortalRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const prefix = location.pathname.split('/')[1] as keyof typeof roleConfig
  const isLoginRoute = location.pathname.endsWith('/login')
  const session = useQuery({
    queryKey: ['role-portal-session', prefix],
    queryFn: () => roleApi<{ user: { role: string | null } }>('/api/v1/admin/me'),
    enabled: Boolean(roleConfig[prefix]) && !isLoginRoute,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  })
  useEffect(() => {
    if (session.isPending || session.isFetching || isLoginRoute) return
    const clearPortalData = () => {
      queryClient.removeQueries({ predicate: ({ queryKey }) => {
        const key = String(queryKey[0] ?? '')
        return key === 'role-portal-session' || key === 'administrator-portal' || /^(finance|inventory|marketing)-/.test(key)
      } })
    }
    const clearAndLeave = () => {
      clearPortalData()
      void signOutRolePortal(navigate, prefix)
    }
    const sessionRole = session.data?.user.role
    if (session.isError) {
      clearAndLeave()
      return
    }
    if (sessionRole !== roleConfig[prefix].role && sessionRole !== 'super_admin') {
      clearPortalData()
      navigate(portalByRole[sessionRole ?? ''] ?? '/admin/access', { replace: true })
      return
    }
    const idleTimeoutMs = 20 * 60_000
    const keepAliveThrottleMs = 30_000
    let idleTimer = 0
    let lastKeepAlive = Date.now()
    let signingOut = false
    const expireSession = () => {
      if (signingOut) return
      signingOut = true
      clearAndLeave()
    }
    const recordActivity = () => {
      if (signingOut) return
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(expireSession, idleTimeoutMs)
      const now = Date.now()
      if (now - lastKeepAlive < keepAliveThrottleMs) return
      lastKeepAlive = now
      void roleApi('/api/v1/admin/session/activity', { method: 'POST' }).catch(() => undefined)
    }
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    activityEvents.forEach((name) => window.addEventListener(name, recordActivity, { passive: true }))
    window.addEventListener('kitculture:admin-session-expired', expireSession)
    recordActivity()
    return () => {
      window.clearTimeout(idleTimer)
      activityEvents.forEach((name) => window.removeEventListener(name, recordActivity))
      window.removeEventListener('kitculture:admin-session-expired', expireSession)
    }
  }, [isLoginRoute, navigate, prefix, queryClient, session.data?.user.role, session.isError, session.isFetching, session.isPending])
  if (location.pathname.endsWith('/login')) return <RolePortalLoginPage />
  if (session.isPending || session.isFetching) return <main className="role-portal-auth-check" role="status">Verifying administrator access...</main>
  if (session.isError || (session.data?.user.role !== roleConfig[prefix].role && session.data?.user.role !== 'super_admin')) {
    return <main className="role-portal-auth-check" role="status">Redirecting to administrator sign in...</main>
  }
  if (prefix === 'laundry-admin') return <LaundryAdminUnavailableWorkspace />
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
      <Link to="/" className="admin-brand" aria-label="MATRIX home"><img src="/matrix-logo.png" alt="MATRIX" /></Link>
      <strong>{config.title}</strong>
      <nav>{config.modules.map((module) => <button type="button" key={module} className={activeModule === module ? 'active' : ''} onClick={() => {
        if (prefix === 'content-admin') {
          const adminSection = ({ Products: 'products', Categories: 'categories', Homepage: 'homepage', 'Site Pages': 'site-pages' } as const)[module as 'Products' | 'Categories' | 'Homepage' | 'Site Pages']
          if (adminSection) {
            navigate(`/sales-admin/${adminSection}`)
            return
          }
        }
        setActiveModule(module)
      }}>{module}</button>)}</nav>
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
