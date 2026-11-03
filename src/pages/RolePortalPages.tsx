import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Boxes, CircleDollarSign, Megaphone, Package, ShoppingBag, Users } from 'lucide-react'
import '../admin-theme.css'

const roleConfig = {
  'sales-admin': { role: 'sales_admin', title: 'Sales and Customer Operations', modules: ['Overview', 'Orders', 'Customers', 'Support'], endpoints: { Orders: '/api/v1/admin/orders', Customers: '/api/v1/admin/customers', Support: '/api/v1/admin/support' }, icon: Users },
  'finance-admin': { role: 'finance_admin', title: 'Finance Operations', modules: ['Overview', 'Transactions', 'Payments', 'Expenses'], endpoints: { Transactions: '/api/v1/admin/reports/financial', Payments: '/api/v1/admin/payments', Expenses: '/api/v1/admin/expenses' }, icon: CircleDollarSign },
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

function currency(value: number | string) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(value) || 0)
}

export function RolePortalRoute() {
  const location = useLocation()
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
  const Icon = config.icon
  const metrics = Object.entries(portal.data?.metrics ?? {})
  const maximum = Math.max(1, ...((portal.data?.series ?? []).map((point) => point.value)))

  return <main className="admin-it-page super-admin-page">
    <aside className="super-admin-sidebar">
      <Link to="/" className="admin-brand"><img src="/culture-mark.webp" alt="" /> KitCulture</Link>
      <strong>{config.title}</strong>
      <nav>{config.modules.map((module) => <button type="button" key={module} className={activeModule === module ? 'active' : ''} onClick={() => setActiveModule(module)}>{module}</button>)}</nav>
      <Link to="/admin/login" className="admin-it-button">Sign out</Link>
    </aside>
    <section className="super-admin-main">
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
