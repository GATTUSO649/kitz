import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  Activity, ArrowRight, BadgeCheck, Bell, Boxes, BriefcaseBusiness, ChartNoAxesCombined,
  ChevronLeft, ChevronRight, CircleAlert, CircleDollarSign, Clock3, FileText, LayoutDashboard,
  LockKeyhole, LogOut, Mail, Megaphone, MonitorCog, Package, RefreshCw, Search, Settings, Shield,
  ShieldAlert, ShieldCheck, UserPlus, Users,
} from 'lucide-react'
import '../super-admin-theme.css'

type Administrator = { id: number; email: string; fullName: string; roleNumber: string | null; role: string | null; status: string; emailVerifiedAt: string | null; lastLoginAt: string | null; createdAt: string }
type AuditEvent = { id: number; action: string; targetType: string; targetId: string; createdAt: string }
type LoginAttempt = { id: number; identity: string; success: boolean; failureCode: string | null; createdAt: string }
type Overview = { total: number; active: number; suspended: number; pending: number; pendingInvitations: number; recentActivity: AuditEvent[]; recentLogins: LoginAttempt[] }
type RoleRecord = { role: string; portal: string }
type PortalSnapshot = { role: string; portal: string; metrics: Record<string, number | string>; series: { label: string; value: number }[] }
type AuditRecord = AuditEvent & { actorName: string | null; actorEmail: string | null }
type AdminProfile = { id: number; fullName: string; email: string; role: string | null; portal: string | null }
type DashboardReport = { period: string; from: string; to: string; totalOrders: number; paidRevenue: string; paidOrderCount: number; averageOrderValue: string; paidPayments: number; pendingOrders: number; totalCustomers: number; newCustomers: number; returningCustomers: number; totalProducts: number; inventoryUnits: number; lowStockVariants: number; outOfStockVariants: number; revenueTrend: { date: string; revenue: string }[] }
type FinancialReport = { grossSales: string; discounts: string; collectedPayments: string; costOfGoodsSold: string | null; operatingExpenses: string; profitAvailable: boolean }
type NotificationCampaign = { id: number; type: string; title: string; body: string; href: string | null; audienceType: string; audienceUserId: number | null; createdAt: string; recipientCount: number; unreadCount: number | null }
type BusinessSettings = Record<string, string>
type PermissionDefinition = { permission: string; description: string; enabled: boolean }
type RolePermissions = { role: string; configured: boolean; permissions: PermissionDefinition[] }
type AdministratorPermissions = { adminId: number; role: string; permissions: { permission: string; description: string; roleGranted: boolean; override: boolean | null; enabled: boolean }[] }
type InternalAlert = { id: string; category: string; severity: string; title: string; detail: string; status: string; createdAt: string }
type CoverageItem = { label: string; state: 'live' | 'partial' | 'gap' }
type Section = 'overview' | 'administrators' | 'roles' | 'systems' | 'security' | 'audit' | 'reports' | 'notifications' | 'settings'

const roleChoices = [
  ['sales_admin', 'Sales and Customers'], ['finance_admin', 'Finance'], ['inventory_admin', 'Inventory and Logistics'],
  ['marketing_admin', 'Marketing'], ['content_admin', 'Products and Content'], ['it_admin', 'IT Operations'],
  ['second_hand_admin', 'Second-Hand Admin'],
] as const
const portalRoles = ['sales_admin', 'finance_admin', 'inventory_admin', 'marketing_admin', 'content_admin', 'it_admin'] as const
const roleDescriptions: Record<string, string> = {
  sales_admin: 'Orders, customers, and support operations',
  finance_admin: 'Payments, expenses, and revenue summaries',
  inventory_admin: 'Product variants and stock movement',
  marketing_admin: 'Campaign activity and audience summaries',
  content_admin: 'Products, categories, and homepage content',
  it_admin: 'Infrastructure, monitoring, and security operations',
  second_hand_admin: 'Second-hand marketplace listings and moderation',
}
const moduleCoverage: Record<Section, CoverageItem[]> = {
  overview: [
    { label: 'Executive dashboard', state: 'live' }, { label: 'System-wide business overview', state: 'live' },
    { label: 'Administrator activity', state: 'live' }, { label: 'Business performance summaries', state: 'live' },
    { label: 'System notifications', state: 'gap' }, { label: 'Recent audit events', state: 'live' },
  ],
  administrators: [
    { label: 'Administrator directory', state: 'live' }, { label: 'Create administrators', state: 'live' },
    { label: 'Assign roles', state: 'live' }, { label: 'Unique administrator numbers', state: 'live' },
    { label: 'Administrator invitations', state: 'live' }, { label: 'Email verification status', state: 'live' },
    { label: 'Activate and suspend', state: 'live' }, { label: 'Credential reset', state: 'live' },
    { label: 'Session revocation', state: 'live' }, { label: 'Administrator profile management', state: 'partial' },
  ],
  roles: [
    { label: 'Role directory', state: 'live' }, { label: 'Permission management', state: 'live' },
    { label: 'Role-permission assignment', state: 'live' }, { label: 'Access review', state: 'live' },
    { label: 'Permission change history', state: 'live' },
  ],
  systems: [
    { label: 'Sales overview', state: 'live' }, { label: 'Finance overview', state: 'live' },
    { label: 'Inventory overview', state: 'live' }, { label: 'Customer overview', state: 'live' },
    { label: 'Products overview', state: 'live' }, { label: 'Marketing overview', state: 'live' },
    { label: 'IT operations overview', state: 'live' },
  ],
  security: [
    { label: 'Active sessions inventory', state: 'gap' }, { label: 'Login activity', state: 'live' },
    { label: 'Failed login activity', state: 'live' }, { label: 'Access management', state: 'partial' },
    { label: 'Security events', state: 'partial' }, { label: 'Session revocation', state: 'live' },
  ],
  audit: [
    { label: 'Administrator activity', state: 'live' }, { label: 'Authentication events', state: 'partial' },
    { label: 'Role changes', state: 'partial' }, { label: 'Permission changes', state: 'partial' },
    { label: 'Account changes', state: 'partial' }, { label: 'Sensitive operations', state: 'partial' },
  ],
  reports: [
    { label: 'Business reports', state: 'live' }, { label: 'Administrator reports', state: 'live' },
    { label: 'Financial summaries', state: 'live' }, { label: 'Inventory summaries', state: 'live' },
    { label: 'System reports', state: 'partial' }, { label: 'Authorized exports', state: 'partial' },
  ],
  notifications: [
    { label: 'System notifications', state: 'partial' }, { label: 'Administrator notifications', state: 'live' },
    { label: 'Security alerts', state: 'live' }, { label: 'Customer announcement campaigns', state: 'live' },
  ],
  settings: [
    { label: 'Super Admin profile', state: 'partial' }, { label: 'Account security', state: 'partial' },
    { label: 'System preferences', state: 'gap' }, { label: 'Application business settings', state: 'partial' },
  ],
}
const navGroups = [
  { title: 'WORKSPACE', items: [{ id: 'overview', label: 'Executive overview', icon: LayoutDashboard }, { id: 'systems', label: 'System overview', icon: ChartNoAxesCombined }] },
  { title: 'PEOPLE & ACCESS', items: [{ id: 'administrators', label: 'Administrators', icon: Users }, { id: 'roles', label: 'Roles & access', icon: Shield }] },
  { title: 'GOVERNANCE', items: [{ id: 'security', label: 'Security & sessions', icon: ShieldCheck }, { id: 'audit', label: 'Audit log', icon: FileText }, { id: 'reports', label: 'Reports', icon: BriefcaseBusiness }] },
  { title: 'PREFERENCES', items: [{ id: 'notifications', label: 'Notifications', icon: Bell }, { id: 'settings', label: 'Settings', icon: Settings }] },
] as const

async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include', headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } })
  if (response.status === 401 && !/\/(?:bootstrap|verify|login)$/.test(path)) window.dispatchEvent(new Event('kitculture:admin-session-expired'))
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? 'Administrator request failed.')
  return payload.data as T
}

function roleLabel(role: string | null) {
  if (!role) return 'Unassigned'
  if (role === 'super_admin') return 'Super Administrator'
  return roleChoices.find(([key]) => key === role)?.[1] ?? role.replaceAll('_', ' ')
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'
}

function exportCsv(filename: string, rows: (string | number | boolean | null | undefined)[][]) {
  const contents = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function Status({ value }: { value: string }) {
  return <span className={`sa-status sa-status-${value}`}>{value}</span>
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="sa-empty"><CircleAlert size={18} /><strong>{title}</strong><p>{detail}</p></div>
}

function ModuleCoverage({ items }: { items: CoverageItem[] }) {
  return <section className="sa-module-coverage" aria-label="Requested module coverage"><span className="sa-eyebrow">MODULE COVERAGE</span><div>{items.map((item) => <span className={`sa-module-chip is-${item.state}`} key={item.label}><i />{item.label}<small>{item.state === 'gap' ? 'API gap' : item.state}</small></span>)}</div></section>
}

function LoginTable({ rows, compact = false }: { rows: LoginAttempt[]; compact?: boolean }) {
  if (!rows.length) return <Empty title="No sign-in records" detail="The API has not returned recent administrator sign-in attempts." />
  const visible = compact ? rows.slice(0, 6) : rows
  return <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>Identity</th><th>Result</th><th>Failure code</th><th>Time</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td><strong>{row.identity}</strong></td><td><span className={`sa-login-result${row.success ? ' is-success' : ' is-failed'}`}>{row.success ? 'Successful' : 'Failed'}</span></td><td>{row.failureCode ?? '—'}</td><td>{formatDate(row.createdAt)}</td></tr>)}</tbody></table></div>
}

function Unavailable({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <section className="sa-unavailable"><span className="sa-unavailable-icon">{icon}</span><span className="sa-eyebrow">INTEGRATION STATUS</span><h2>{title}</h2><p>{detail}</p><span className="sa-status sa-status-watch">NO API AVAILABLE</span></section>
}

function RoleAdministratorGroups({ roles, administrators, isPending, isError }: { roles: RoleRecord[]; administrators: Administrator[]; isPending: boolean; isError: boolean }) {
  const groupedRoles = roles.filter((role) => role.role !== 'super_admin')
  return <section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">ASSIGNED ROLE GROUPS</span><h2>Administrators by portal role</h2></div><Users size={18} /></div>
    {isPending ? <LoadingRows /> : isError ? <Empty title="Role groups unavailable" detail="The administrator directory or role list could not be loaded." /> : groupedRoles.length ? <div className="sa-role-grid">{groupedRoles.map((item) => {
      const members = administrators.filter((admin) => admin.role === item.role)
      const activeMembers = members.filter((admin) => admin.status === 'active').length
      return <article className="sa-role-card" key={item.role}><span className="sa-role-icon"><ShieldCheck size={17} /></span><span className="sa-status sa-status-active">{activeMembers} ACTIVE</span><h3>{roleLabel(item.role)}</h3><p>{members.length} assigned administrator{members.length === 1 ? '' : 's'} · {members.filter((admin) => admin.status === 'pending').length} awaiting verification</p><div><small>Portal</small><code>{item.portal}</code></div>{members.length ? <ol className="sa-timeline">{members.map((admin) => <li key={admin.id}><span className="sa-timeline-mark"><Users size={14} /></span><div><strong>{admin.fullName}</strong><small>{admin.email} · {admin.status}{admin.emailVerifiedAt ? ' · email verified' : ' · email unverified'}</small></div></li>)}</ol> : <p className="sa-panel-copy">No administrators assigned yet.</p>}</article>
    })}</div> : <Empty title="No role groups defined" detail="Defined administrator roles will appear here." />}
  </section>
}

function RolePermissionsEditor({ roles }: { roles: RoleRecord[] }) {
  const queryClient = useQueryClient()
  const [role, setRole] = useState('sales_admin')
  const roleOptions = roles.filter((item) => item.role !== 'super_admin')
  const selectedRole = roleOptions.some((item) => item.role === role) ? role : roleOptions[0]?.role ?? ''
  const permissionQuery = useQuery({ queryKey: ['super-admin', 'role-permissions', selectedRole], queryFn: () => adminApi<RolePermissions>(`/api/v1/admin/ecosystem/roles/${selectedRole}/permissions`), enabled: Boolean(selectedRole), retry: false })
  const save = useMutation({
    mutationFn: (permissions: string[]) => adminApi(`/api/v1/admin/ecosystem/roles/${selectedRole}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions }) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['super-admin', 'role-permissions', selectedRole] }) },
  })
  const selected = permissionQuery.data?.permissions ?? []
  const enabled = selected.filter((item) => item.enabled).map((item) => item.permission)
  return <section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">ROLE PERMISSIONS</span><h2>Assign permissions to a role</h2></div><Shield size={18} /></div>
    <label className="sa-permission-role">Administrator role<select value={selectedRole} onChange={(event) => setRole(event.target.value)}>{roleOptions.map((item) => <option key={item.role} value={item.role}>{roleLabel(item.role)}</option>)}</select></label>
    {permissionQuery.isPending ? <LoadingRows /> : permissionQuery.isError ? <Empty title="Permission assignments unavailable" detail={permissionQuery.error.message} /> : <>
      <p className="sa-panel-copy">{permissionQuery.data?.configured ? 'This role uses its saved permission assignment.' : 'No saved assignment exists; current application defaults are shown until you save a custom set.'}</p>
      <div className="sa-permission-list">{selected.map((item) => <label key={item.permission}><input type="checkbox" checked={item.enabled} disabled={save.isPending} onChange={(event) => { const next = new Set(enabled); if (event.target.checked) next.add(item.permission); else next.delete(item.permission); if (!next.size) { save.reset(); return }; save.mutate([...next]) }} /><span><strong>{item.permission}</strong><small>{item.description}</small></span></label>)}</div>
      {save.isError && <p className="sa-message is-error" role="alert">{save.error.message}</p>}
      {save.isSuccess && <p className="sa-message is-success" role="status">Role permissions saved and audit logged.</p>}
    </>}
  </section>
}

function AdministratorPermissionOverrides({ adminId, role }: { adminId: number; role: string | null }) {
  const queryClient = useQueryClient()
  const key = ['super-admin', 'administrator-permissions', adminId]
  const query = useQuery({ queryKey: key, queryFn: () => adminApi<AdministratorPermissions>(`/api/v1/admin/ecosystem/administrators/${adminId}/permissions`), retry: false })
  const update = useMutation({
    mutationFn: (input: { permission: string; granted: boolean | null }) => adminApi(`/api/v1/admin/ecosystem/administrators/${adminId}/permissions/${encodeURIComponent(input.permission)}`, { method: 'PATCH', body: JSON.stringify({ granted: input.granted }) }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: ['super-admin', 'audit-log'] })]) },
  })
  if (role === 'super_admin') return <div className="sa-capability-note"><LockKeyhole size={16} /><span><strong>Super Admin permissions are immutable.</strong> The Super Admin always retains the full permission set.</span></div>
  if (query.isPending) return <LoadingRows />
  if (query.isError) return <Empty title="Permission overrides unavailable" detail={query.error.message} />
  return <><div className="sa-permission-list">{query.data?.permissions.map((item) => <label key={item.permission}><span><strong>{item.permission}</strong><small>{item.description} · role default: {item.roleGranted ? 'allow' : 'deny'}</small></span><select aria-label={`Override ${item.permission}`} value={item.override === null ? 'inherit' : item.override ? 'allow' : 'deny'} disabled={update.isPending} onChange={(event) => { const value = event.target.value; update.mutate({ permission: item.permission, granted: value === 'inherit' ? null : value === 'allow' }) }}><option value="inherit">Use role</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label>)}</div>{update.isError && <p className="sa-message is-error" role="alert">{update.error.message}</p>}{update.isSuccess && <p className="sa-message is-success" role="status">Permission override saved and audit logged.</p>}</>
}

export function SuperAdminConsole() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [section, setSection] = useState<Section>('overview')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('current')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedAdminIds, setSelectedAdminIds] = useState<number[]>([])
  const [page, setPage] = useState(1)
  const [reportPeriod, setReportPeriod] = useState('last30days')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const pageSize = 8

  const adminProfile = useQuery({ queryKey: ['super-admin', 'profile'], queryFn: async () => { const result = await adminApi<{ user: Omit<AdminProfile, 'role' | 'portal'> & { role?: string | null }; portal: string | null }>('/api/v1/admin/me'); return { ...result.user, role: result.user.role ?? null, portal: result.portal } }, staleTime: 0, refetchOnMount: 'always', retry: false })
  const isSuperAdmin = adminProfile.data?.role === 'super_admin'
  const overview = useQuery({ queryKey: ['super-admin', 'overview'], queryFn: () => adminApi<Overview>('/api/v1/admin/ecosystem'), enabled: isSuperAdmin, retry: false, refetchInterval: 30_000 })
  const administrators = useQuery({ queryKey: ['super-admin', 'administrators'], queryFn: () => adminApi<Administrator[]>('/api/v1/admin/ecosystem/administrators'), enabled: isSuperAdmin, retry: false })
  const roles = useQuery({ queryKey: ['super-admin', 'roles'], queryFn: () => adminApi<RoleRecord[]>('/api/v1/admin/ecosystem/roles'), enabled: isSuperAdmin, retry: false })
  const systems = useQueries({ queries: portalRoles.map((role) => ({ queryKey: ['super-admin', 'system', role], queryFn: () => adminApi<PortalSnapshot>(`/api/v1/admin/portal/${role}`), enabled: isSuperAdmin && section === 'systems', retry: false, refetchInterval: 60_000 })) })
  const businessOverview = useQuery({ queryKey: ['super-admin', 'business-overview', reportPeriod], queryFn: () => adminApi<DashboardReport>(`/api/v1/admin/dashboard?period=${reportPeriod}`), enabled: isSuperAdmin && ['overview', 'systems', 'reports'].includes(section), retry: false, refetchInterval: 60_000 })
  const financialReport = useQuery({ queryKey: ['super-admin', 'financial-report'], queryFn: () => adminApi<FinancialReport>('/api/v1/admin/reports/financial'), enabled: isSuperAdmin && section === 'reports', retry: false })
  const auditLog = useQuery({ queryKey: ['super-admin', 'audit-log'], queryFn: () => adminApi<AuditRecord[]>('/api/v1/admin/audit'), enabled: isSuperAdmin && (section === 'audit' || section === 'reports' || section === 'security' || section === 'roles'), retry: false })
  const campaigns = useQuery({ queryKey: ['super-admin', 'customer-announcements'], queryFn: () => adminApi<NotificationCampaign[]>('/api/v1/admin/notifications'), enabled: isSuperAdmin && section === 'notifications', retry: false })
  const internalAlerts = useQuery({ queryKey: ['super-admin', 'internal-alerts'], queryFn: () => adminApi<InternalAlert[]>('/api/v1/admin/ecosystem/alerts'), enabled: isSuperAdmin && section === 'notifications', retry: false })
  const settings = useQuery({ queryKey: ['super-admin', 'application-settings'], queryFn: () => adminApi<BusinessSettings>('/api/v1/admin/settings'), enabled: isSuperAdmin && section === 'settings', retry: false })
  const selected = administrators.data?.find((admin) => admin.id === selectedId) ?? null
  const securityEvents = (auditLog.data ?? []).filter((event) => /security|session|permission|login|password|access/i.test(event.action))
  const permissionHistory = (auditLog.data ?? []).filter((event) => /permission|role_permission/i.test(event.action))
  const selectedActivity = useQuery({ queryKey: ['super-admin', 'activity', selectedId], queryFn: () => adminApi<AuditEvent[]>(`/api/v1/admin/ecosystem/administrators/${selectedId}/activity`), enabled: isSuperAdmin && selectedId !== null && section === 'administrators', retry: false })

  useEffect(() => {
    if (adminProfile.isError && adminProfile.error.message.toLowerCase().includes('sign in')) {
      navigate('/super-admin/login', { replace: true })
      return
    }
    if (!adminProfile.data || adminProfile.data.role === 'super_admin') return
    navigate(adminProfile.data.portal ?? '/admin/login', { replace: true })
  }, [adminProfile.data, adminProfile.error, adminProfile.isError, navigate])

  useEffect(() => {
    if (!isSuperAdmin || adminProfile.isPending || adminProfile.isFetching) return
    let idleTimer = 0
    let lastKeepAlive = Date.now()
    let signingOut = false
    const leaveForLogin = () => {
      queryClient.removeQueries({ queryKey: ['super-admin'] })
      navigate('/super-admin/login', { replace: true })
    }
    const expireSession = () => {
      if (signingOut) return
      signingOut = true
      void adminApi('/api/v1/admin/logout', { method: 'POST', body: '{}' }).catch(() => undefined).finally(leaveForLogin)
    }
    const recordActivity = () => {
      if (signingOut) return
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(expireSession, 20 * 60_000)
      const now = Date.now()
      if (now - lastKeepAlive < 30_000) return
      lastKeepAlive = now
      void adminApi('/api/v1/admin/session/activity', { method: 'POST' }).catch(() => undefined)
    }
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    activityEvents.forEach((name) => window.addEventListener(name, recordActivity, { passive: true }))
    window.addEventListener('kitculture:admin-session-expired', leaveForLogin)
    recordActivity()
    return () => {
      window.clearTimeout(idleTimer)
      activityEvents.forEach((name) => window.removeEventListener(name, recordActivity))
      window.removeEventListener('kitculture:admin-session-expired', leaveForLogin)
    }
  }, [adminProfile.isFetching, adminProfile.isPending, isSuperAdmin, navigate, queryClient])

  const filtered = useMemo(() => (administrators.data ?? []).filter((admin) => {
    const query = search.trim().toLowerCase()
    const matchesText = !query || [admin.fullName, admin.email, admin.roleNumber ?? '', roleLabel(admin.role)].some((value) => value.toLowerCase().includes(query))
    const matchesStatus = statusFilter === 'current' ? admin.status !== 'disabled'
      : statusFilter === 'archived' ? admin.status === 'disabled'
        : statusFilter === 'all' || admin.status === statusFilter
    return matchesText && matchesStatus
  }), [administrators.data, search, statusFilter])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visibleAdmins = filtered.slice((page - 1) * pageSize, page * pageSize)
  const selectableVisibleIds = visibleAdmins.filter((admin) => admin.status !== 'disabled' && admin.id !== adminProfile.data?.id).map((admin) => admin.id)
  const allVisibleSelected = selectableVisibleIds.length > 0 && selectableVisibleIds.every((id) => selectedAdminIds.includes(id))

  const refresh = () => { setError(''); return queryClient.invalidateQueries({ queryKey: ['super-admin'] }) }
  const signOut = async () => {
    try {
      await adminApi('/api/v1/admin/logout', { method: 'POST', body: '{}' })
      window.location.assign('/super-admin/login')
    } catch (issue) { reportFailure(issue, 'Sign out could not be completed.') }
  }
  const reportFailure = (issue: unknown, fallback: string) => { setNotice(''); setError(issue instanceof Error ? issue.message : fallback) }
  const confirmStatus = async (admin: Administrator, action: 'activate' | 'suspend' | 'disable') => {
    const label = action === 'activate' ? 'activate' : action
    if (!window.confirm(`${label[0].toUpperCase()}${label.slice(1)} ${admin.fullName}'s account?`)) return
    try {
      setError('')
      await adminApi(`/api/v1/admin/ecosystem/administrators/${admin.id}/status`, { method: 'POST', body: JSON.stringify({ action }) })
      setNotice(action === 'activate' ? 'Account activated.' : action === 'suspend' ? 'Account suspended.' : 'Account disabled.')
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['super-admin', 'administrators'] }), queryClient.invalidateQueries({ queryKey: ['super-admin', 'overview'] })])
    } catch (issue) { reportFailure(issue, 'Account status could not be changed.') }
  }
  const archiveAdministrators = async (ids: number[]) => {
    const targets = (administrators.data ?? []).filter((admin) => ids.includes(admin.id) && admin.id !== adminProfile.data?.id && admin.status !== 'disabled')
    if (!targets.length) return
    const names = targets.map((admin) => admin.fullName).join(', ')
    if (!window.confirm(`Archive ${targets.length === 1 ? 'this administrator' : `${targets.length} administrators`}: ${names}? They will lose access and all sessions will be revoked.`)) return
    try {
      setError('')
      const result = await adminApi<{ archived: number }>('/api/v1/admin/ecosystem/administrators/archive', { method: 'POST', body: JSON.stringify({ ids: targets.map((admin) => admin.id) }) })
      setNotice(`${result.archived} administrator${result.archived === 1 ? '' : 's'} archived. Access was removed and sessions were revoked.`)
      setSelectedAdminIds([])
      setSelectionMode(false)
      setSelectedId(null)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['super-admin', 'administrators'] }), queryClient.invalidateQueries({ queryKey: ['super-admin', 'overview'] })])
    } catch (issue) { reportFailure(issue, 'Administrator accounts could not be archived.') }
  }
  const removeAdministrator = (admin: Administrator) => archiveAdministrators([admin.id])
  const deleteArchivedAdministrator = async (admin: Administrator) => {
    if (admin.status !== 'disabled' || !window.confirm(`Permanently delete archived account ${admin.fullName} (${admin.email})? This cannot be undone. Audit events will be retained without the account identity.`)) return
    try {
      setError('')
      await adminApi(`/api/v1/admin/ecosystem/administrators/${admin.id}`, { method: 'DELETE' })
      setNotice(`Archived account for ${admin.fullName} was permanently deleted.`)
      setSelectedId(null)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['super-admin', 'administrators'] }), queryClient.invalidateQueries({ queryKey: ['super-admin', 'overview'] })])
    } catch (issue) { reportFailure(issue, 'Archived administrator could not be deleted.') }
  }
  const changeRole = async (id: number, role: string) => {
    try {
      setError('')
      const result = await adminApi<{ updated: boolean; roleNumber: string | null }>(`/api/v1/admin/ecosystem/administrators/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) })
      const target = administrators.data?.find((admin) => admin.id === id)
      setNotice(result.updated
        ? `Administrator role updated to ${roleLabel(role)}. New role number: ${result.roleNumber ?? 'not assigned'}.${target?.status === 'pending' ? ' Resend the invitation to share the updated role number.' : ' Previous individual permission overrides were cleared, and existing sessions were revoked. The administrator must sign in again.'}`
        : 'Administrator already has that role.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'administrators'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin', 'administrator-permissions', id] }),
      ])
    } catch (issue) { reportFailure(issue, 'Role could not be changed.') }
  }
  const revokeSessions = async (admin: Administrator) => {
    if (!window.confirm(`Revoke all sessions for ${admin.fullName}? They will need to sign in again.`)) return
    try {
      setError('')
      await adminApi(`/api/v1/admin/ecosystem/administrators/${admin.id}/sessions/revoke`, { method: 'POST', body: '{}' })
      setNotice(`Sessions revoked for ${admin.fullName}.`)
      await queryClient.invalidateQueries({ queryKey: ['super-admin', 'activity', admin.id] })
    } catch (issue) { reportFailure(issue, 'Sessions could not be revoked.') }
  }
  const resetPassword = async (admin: Administrator) => {
    const password = window.prompt(`New password for ${admin.fullName} (14 to 128 characters).`)
    if (!password) return
    if (password.length < 14 || password.length > 128) { setError('Password must be between 14 and 128 characters.'); return }
    try {
      setError('')
      await adminApi(`/api/v1/admin/ecosystem/administrators/${admin.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) })
      setNotice(`Password reset for ${admin.fullName}; existing sessions were revoked.`)
    } catch (issue) { reportFailure(issue, 'Password could not be reset.') }
  }
  const resendInvitation = async (admin: Administrator) => {
    try {
      setError('')
      const result = await adminApi<{ deliveryStatus: string }>(`/api/v1/admin/ecosystem/administrators/${admin.id}/invitation/resend`, { method: 'POST', body: '{}' })
      setNotice(`Invitation delivery status: ${result.deliveryStatus}.`)
      await queryClient.invalidateQueries({ queryKey: ['super-admin', 'administrators'] })
    } catch (issue) { reportFailure(issue, 'Invitation could not be resent.') }
  }

  const invitation = useMutation({
    mutationFn: (input: { fullName: string; email: string; role: string }) => adminApi<{ roleNumber: string; deliveryStatus: string }>('/api/v1/admin/ecosystem/administrators/invite', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: async (result) => {
      setError('')
      setNotice(`Administrator ${result.roleNumber} created. Invitation: ${result.deliveryStatus}.`)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['super-admin', 'administrators'] }), queryClient.invalidateQueries({ queryKey: ['super-admin', 'overview'] })])
    },
    onError: (issue) => reportFailure(issue, 'Invitation could not be created.'),
  })
  const updateSettings = useMutation({
    mutationFn: (input: BusinessSettings) => adminApi<BusinessSettings>('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: async () => {
      setError('')
      setNotice('Application settings saved and the change was audited.')
      await queryClient.invalidateQueries({ queryKey: ['super-admin', 'application-settings'] })
    },
    onError: (issue) => reportFailure(issue, 'Application settings could not be saved.'),
  })
  const downloadAdmins = () => exportCsv('kitculture-administrators.csv', [['Name', 'Email', 'Role number', 'Role', 'Status', 'Email verified', 'Last login', 'Created'], ...(administrators.data ?? []).map((admin) => [admin.fullName, admin.email, admin.roleNumber, roleLabel(admin.role), admin.status, Boolean(admin.emailVerifiedAt), admin.lastLoginAt, admin.createdAt])])
  const downloadAudit = () => exportCsv('kitculture-admin-audit.csv', [['Action', 'Actor', 'Actor email', 'Target type', 'Target ID', 'Time'], ...(auditLog.data ?? []).map((event) => [event.action, event.actorName, event.actorEmail, event.targetType, event.targetId, event.createdAt])])
  const downloadLogins = () => exportCsv('kitculture-admin-logins.csv', [['Identity', 'Result', 'Failure code', 'Time'], ...(overview.data?.recentLogins ?? []).map((row) => [row.identity, row.success ? 'success' : 'failed', row.failureCode, row.createdAt])])
  const downloadBusinessReport = () => exportCsv('kitculture-business-report.csv', [['Period', businessOverview.data?.period], ['From', businessOverview.data?.from], ['To', businessOverview.data?.to], ['Orders', businessOverview.data?.totalOrders], ['Paid revenue (KES)', businessOverview.data?.paidRevenue], ['Paid orders', businessOverview.data?.paidOrderCount], ['Average order value (KES)', businessOverview.data?.averageOrderValue], ['Pending orders', businessOverview.data?.pendingOrders], ['Customers', businessOverview.data?.totalCustomers], ['New customers', businessOverview.data?.newCustomers], ['Returning customers', businessOverview.data?.returningCustomers], ['Products', businessOverview.data?.totalProducts], ['Inventory units', businessOverview.data?.inventoryUnits], ['Low-stock variants', businessOverview.data?.lowStockVariants], ['Out-of-stock variants', businessOverview.data?.outOfStockVariants]])
  const downloadFinancialReport = () => exportCsv('kitculture-financial-summary.csv', [['Metric', 'Amount (KES)'], ['Gross sales', financialReport.data?.grossSales], ['Discounts', financialReport.data?.discounts], ['Collected payments', financialReport.data?.collectedPayments], ['Cost of goods sold', financialReport.data?.costOfGoodsSold], ['Operating expenses', financialReport.data?.operatingExpenses], ['Profit available', financialReport.data?.profitAvailable]])

  if (adminProfile.isPending || adminProfile.isFetching) return <main className="sa-gate" role="status"><div><Shield size={25} /><span className="sa-eyebrow">CHECKING ACCESS</span><h1>Verifying administrator session</h1></div></main>
  if (Boolean(adminProfile.isError)) return <Navigate to="/super-admin/login" replace />
  if (!isSuperAdmin) return <Navigate to={adminProfile.data?.portal ?? '/super-admin/login'} replace />
  if (overview.isError && !overview.data) {
    const signInRequired = overview.error instanceof Error && overview.error.message.toLowerCase().includes('sign in')
    return <main className="sa-gate"><div><ShieldAlert size={25} /><span className="sa-eyebrow">{signInRequired ? 'RESTRICTED AREA' : 'CONSOLE UNAVAILABLE'}</span><h1>{signInRequired ? 'Super Admin sign-in required' : 'Could not load Super Admin'}</h1><p>{signInRequired ? 'Your administrator session is missing or has expired.' : overview.error instanceof Error ? overview.error.message : 'The service could not be reached.'}</p>{signInRequired ? <a href="/super-admin/login">Go to secure sign in <ArrowRight size={15} /></a> : <button className="sa-button sa-button-primary" type="button" onClick={() => void refresh()}><RefreshCw size={14} /> Try again</button>}</div></main>
  }

  const headings: Record<Section, { eyebrow: string; title: string; detail: string }> = {
    overview: { eyebrow: 'PLATFORM GOVERNANCE', title: 'Executive overview', detail: 'Administrator access, authentication, and system activity across KitCulture.' },
    administrators: { eyebrow: 'IDENTITY DIRECTORY', title: 'Administrators', detail: 'Invite, review, and manage administrator accounts.' },
    roles: { eyebrow: 'ACCESS GOVERNANCE', title: 'Roles & access', detail: 'Review administrator roles exposed by the platform.' },
    systems: { eyebrow: 'BUSINESS SYSTEMS', title: 'System overview', detail: 'Authorized data snapshots from each administrator portal.' },
    security: { eyebrow: 'ACCOUNT PROTECTION', title: 'Security & sessions', detail: 'Review sign-in outcomes and revoke administrator sessions.' },
    audit: { eyebrow: 'ACCOUNTABILITY', title: 'Audit log', detail: 'Recent administrator actions recorded by the central service.' },
    reports: { eyebrow: 'DATA EXPORTS', title: 'Reports', detail: 'Export the authorized administrator and audit data currently available.' },
    notifications: { eyebrow: 'SYSTEM MESSAGES', title: 'Notifications', detail: 'Review customer announcement campaigns and the current internal alert integration gaps.' },
    settings: { eyebrow: 'CONSOLE PREFERENCES', title: 'Settings', detail: 'Review the signed-in profile and manage supported, audited business settings.' },
  }
  const heading = headings[section]

  return <main className="sa-shell">
    <aside className="sa-sidebar">
      <a className="sa-brand" href="/super-admin/dashboard" aria-label="MATRIX Super Admin"><img className="sa-brand-logo" src="/matrix-logo.png" alt="MATRIX" /><span><small>CONTROL PLANE</small></span></a>
      <div className="sa-sidebar-rule" />
      {navGroups.map((group) => <div className="sa-nav-group" key={group.title}><span className="sa-nav-heading">{group.title}</span><nav aria-label={group.title}>{group.items.map((item) => { const Icon = item.icon; const active = section === item.id; return <button key={item.id} className={`sa-nav-item${active ? ' is-active' : ''}`} type="button" aria-current={active ? 'page' : undefined} onClick={() => { setSection(item.id); setError(''); setNotice('') }}><Icon size={16} /><span>{item.label}</span>{item.id === 'administrators' && overview.data?.pending ? <b>{overview.data.pending}</b> : null}</button> })}</nav></div>)}
      <div className="sa-sidebar-bottom"><div className="sa-access-card"><span className="sa-access-icon"><LockKeyhole size={15} /></span><span><strong>Protected workspace</strong><small>Role checks enforced by API</small></span></div><a className="sa-operations-link" href="/operations"><MonitorCog size={15} /><span>Operations console</span><ArrowRight size={14} /></a></div>
    </aside>
    {selected && selected.status !== 'disabled' && <button className="sa-global-remove-button" type="button" aria-label={`Remove administrator access for ${selected.fullName}`} disabled={selected.role === 'super_admin'} onClick={() => void removeAdministrator(selected)}>Remove access: {selected.fullName}</button>}
    {selected?.status === 'disabled' && <button className="sa-global-remove-button" type="button" aria-label={`Permanently delete archived account for ${selected.fullName}`} onClick={() => void deleteArchivedAdministrator(selected)}>Delete archived account: {selected.fullName}</button>}
    <section className="sa-main">
      <header className="sa-topbar"><div className="sa-crumb"><img className="sa-crumb-logo" src="/matrix-logo.png" alt="MATRIX" /><ChevronRight size={13} /><strong>Super Admin</strong></div><div className="sa-topbar-actions"><span className={`sa-health${overview.isFetching ? ' is-loading' : ''}`}><i />{overview.isFetching ? 'Refreshing' : 'Live data'}</span><button type="button" className="sa-icon-button" aria-label="Refresh data" title="Refresh data" onClick={() => void refresh()}><RefreshCw size={15} /></button><span className="sa-user-chip"><span>SA</span><strong>{adminProfile.data?.fullName ?? 'Super Admin'}</strong></span><button type="button" className="sa-icon-button" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut size={15} /></button></div></header>
      <div className="sa-content">
        <div className="sa-page-heading"><div><span className="sa-eyebrow">{heading.eyebrow}</span><h1>{heading.title}</h1><p>{heading.detail}</p></div>{section === 'administrators' && <a className="sa-button sa-button-primary" href="#invite-admin"><UserPlus size={15} /> Invite administrator</a>}</div>
        {error && <div className="sa-message is-error" role="alert"><CircleAlert size={16} /><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
        {notice && <div className="sa-message is-success" role="status"><BadgeCheck size={16} /><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
        <ModuleCoverage items={moduleCoverage[section]} />

        {section === 'overview' && <>
          <div className="sa-stat-grid">{[
            { label: 'Total administrators', value: overview.data?.total, icon: Users, tone: 'blue' },
            { label: 'Active accounts', value: overview.data?.active, icon: BadgeCheck, tone: 'green' },
            { label: 'Pending verification', value: overview.data?.pending, icon: Mail, tone: 'amber' },
            { label: 'Open invitations', value: overview.data?.pendingInvitations, icon: UserPlus, tone: 'cyan' },
          ].map((stat) => <article className="sa-stat-card" key={stat.label}><span className={`sa-stat-icon is-${stat.tone}`}><stat.icon size={17} /></span><span className="sa-stat-label">{stat.label}</span><strong>{overview.isPending && !overview.data ? <i className="sa-skeleton" /> : stat.value ?? '—'}</strong><small>{stat.label === 'Active accounts' ? `${overview.data?.suspended ?? 0} suspended` : 'Current system count'}</small></article>)}</div>
          <section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">LAST 30 DAYS</span><h2>Business performance</h2></div><button className="sa-text-button" type="button" onClick={() => setSection('reports')}>Open reports <ArrowRight size={14} /></button></div>{businessOverview.isPending ? <LoadingRows /> : businessOverview.isError ? <p className="sa-inline-error">Business metrics unavailable: {businessOverview.error.message}</p> : <div className="sa-report-metrics sa-overview-business"><div><span>Orders</span><strong>{businessOverview.data?.totalOrders ?? '—'}</strong></div><div><span>Collected revenue</span><strong>KES {Number(businessOverview.data?.paidRevenue ?? 0).toLocaleString('en-KE')}</strong></div><div><span>New customers</span><strong>{businessOverview.data?.newCustomers ?? '—'}</strong></div><div><span>Returning customers</span><strong>{businessOverview.data?.returningCustomers ?? '—'}</strong></div><div><span>Inventory units</span><strong>{businessOverview.data?.inventoryUnits ?? '—'}</strong></div><div><span>Products</span><strong>{businessOverview.data?.totalProducts ?? '—'}</strong></div></div>}</section>
          <div className="sa-overview-grid"><section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">RECENT CHANGES</span><h2>Administrator activity</h2></div><button className="sa-text-button" type="button" onClick={() => setSection('audit')}>View audit log <ArrowRight size={14} /></button></div>{overview.data?.recentActivity.length ? <ol className="sa-timeline">{overview.data.recentActivity.slice(0, 7).map((event) => <li key={event.id}><span className="sa-timeline-mark"><Activity size={14} /></span><div><strong>{event.action.replaceAll('.', ' ')}</strong><small>{event.targetType} · {event.targetId}</small></div><time>{formatDate(event.createdAt)}</time></li>)}</ol> : overview.isPending ? <LoadingRows /> : <Empty title="No audit activity yet" detail="Recorded administrator actions will appear here." />}</section><section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">ACCESS POSTURE</span><h2>Account status</h2></div><Shield size={17} /></div><div className="sa-posture-row"><i className="sa-dot is-green" /><span>Active</span><strong>{overview.data?.active ?? '—'}</strong></div><div className="sa-posture-row"><i className="sa-dot is-amber" /><span>Pending verification</span><strong>{overview.data?.pending ?? '—'}</strong></div><div className="sa-posture-row"><i className="sa-dot is-red" /><span>Suspended</span><strong>{overview.data?.suspended ?? '—'}</strong></div><div className="sa-posture-note"><ShieldCheck size={15} /><span>Authorization is checked by the API for each administrator action.</span></div></section></div>
          <section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">AUTHENTICATION</span><h2>Recent sign-ins</h2></div><button className="sa-text-button" type="button" onClick={() => setSection('security')}>Security details <ArrowRight size={14} /></button></div>{overview.isPending && !overview.data ? <LoadingRows /> : <LoginTable rows={overview.data?.recentLogins ?? []} compact />}</section>
        </>}

        {section === 'administrators' && <>
          <section className="sa-panel sa-invite-panel" id="invite-admin"><div className="sa-panel-heading"><div><span className="sa-eyebrow">CREATE ACCOUNT</span><h2>Invite an administrator</h2></div><span className="sa-inline-note"><Mail size={14} /> Invitation link by email</span></div><form className="sa-invite-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); invitation.mutate({ fullName: String(data.get('fullName')).trim(), email: String(data.get('email')).trim(), role: String(data.get('role')) }); event.currentTarget.reset() }}><label>Full name<input name="fullName" required minLength={2} maxLength={160} placeholder="Administrator name" /></label><label>Email address<input name="email" type="email" required maxLength={254} placeholder="name@company.com" /></label><label>Portal role<select name="role" defaultValue="sales_admin">{roleChoices.map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label><button className="sa-button sa-button-primary" type="submit" disabled={invitation.isPending}>{invitation.isPending ? <><RefreshCw size={14} className="sa-spin" /> Sending</> : <><UserPlus size={15} /> Create invitation</>}</button></form></section>
          <section className="sa-panel">
            <div className="sa-panel-heading sa-directory-heading">
              <div><span className="sa-eyebrow">IDENTITY DIRECTORY</span><h2>Administrator accounts <small>{administrators.data?.length ?? 0}</small></h2></div>
              <div className="sa-table-tools">
                <label className="sa-search"><Search size={15} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search name, email or ID" aria-label="Search administrators" /></label>
                <label className="sa-filter"><span>View</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); setSelectedAdminIds([]) }}><option value="current">Current accounts</option><option value="archived">Archive</option><option value="all">All accounts</option><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option></select></label>
                <button className="sa-button sa-button-secondary" type="button" onClick={() => { setSelectionMode((enabled) => !enabled); setSelectedAdminIds([]) }}>{selectionMode ? 'Cancel selection' : 'Select accounts'}</button>
                {selectionMode && <button className="sa-button sa-button-primary" type="button" disabled={!selectedAdminIds.length} onClick={() => void archiveAdministrators(selectedAdminIds)}>Archive selected ({selectedAdminIds.length})</button>}
              </div>
            </div>
            {administrators.isPending ? <LoadingRows /> : administrators.isError ? <Empty title="Directory unavailable" detail={administrators.error.message} /> : filtered.length === 0 ? <Empty title={statusFilter === 'archived' ? 'Archive is empty' : 'No administrators match'} detail="Try another search or directory view." /> : <>
              <div className="sa-table-wrap"><table className="sa-table"><thead><tr>{selectionMode && <th><input type="checkbox" aria-label="Select all eligible visible administrators" checked={allVisibleSelected} onChange={(event) => setSelectedAdminIds(event.target.checked ? [...new Set([...selectedAdminIds, ...selectableVisibleIds])] : selectedAdminIds.filter((id) => !selectableVisibleIds.includes(id)))} /></th>}<th>Administrator</th><th>Role number</th><th>Portal</th><th>Status</th><th>Email</th><th>Last sign-in</th><th>Actions</th></tr></thead><tbody>{visibleAdmins.map((admin) => <tr key={admin.id}>{selectionMode && <td><input type="checkbox" aria-label={`Select ${admin.fullName}`} checked={selectedAdminIds.includes(admin.id)} disabled={admin.status === 'disabled' || admin.id === adminProfile.data?.id} onChange={(event) => setSelectedAdminIds((ids) => event.target.checked ? [...ids, admin.id] : ids.filter((id) => id !== admin.id))} /></td>}<td><button className="sa-person-cell" type="button" onClick={() => setSelectedId(selectedId === admin.id ? null : admin.id)}><span>{admin.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><strong>{admin.fullName}<small>{admin.email}</small></strong></button></td><td className="sa-mono">{admin.roleNumber ?? '—'}</td><td>{roleLabel(admin.role)}</td><td><Status value={admin.status} /></td><td><span className={`sa-verified${admin.emailVerifiedAt ? ' is-verified' : ''}`}>{admin.emailVerifiedAt ? <><BadgeCheck size={13} /> Verified</> : <><Clock3 size={13} /> Unverified</>}</span></td><td>{formatDate(admin.lastLoginAt)}</td><td><div className="sa-row-actions"><select aria-label={`Change role for ${admin.fullName}`} value={admin.role ?? ''} disabled={admin.role === 'super_admin'} onChange={(event) => void changeRole(admin.id, event.target.value)}><option value="" disabled>Role</option>{admin.role === 'super_admin' && <option value="super_admin">Super Administrator</option>}{roleChoices.map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select>{admin.status === 'pending' && <button className="sa-mini-button" type="button" onClick={() => void resendInvitation(admin)}>Resend invite</button>}{admin.status === 'disabled' && admin.id !== adminProfile.data?.id && <button className="sa-mini-button is-positive" type="button" onClick={() => void confirmStatus(admin, 'activate')}>Restore</button>}{admin.status !== 'disabled' && admin.id !== adminProfile.data?.id && <button className="sa-mini-button is-danger" type="button" onClick={() => void removeAdministrator(admin)}>Archive</button>}{admin.status !== 'disabled' && admin.role !== 'super_admin' && <button className="sa-mini-button is-danger" type="button" onClick={() => void confirmStatus(admin, 'suspend')}>Suspend</button>}<button className="sa-mini-button" type="button" disabled={admin.role === 'super_admin'} onClick={() => void resetPassword(admin)}>Reset password</button></div></td></tr>)}</tbody></table></div><div className="sa-pagination"><span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div><button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /></button><strong>{page} / {pageCount}</strong><button type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={15} /></button></div></div>
            </>}
          </section>
          {selected && <><section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">ACCOUNT PROFILE</span><h2>{selected.fullName}</h2></div><button className="sa-text-button" type="button" onClick={() => setSelectedId(null)}>Close profile</button></div><div className="sa-profile-grid"><span>Email<strong>{selected.email}</strong></span><span>Role number<strong>{selected.roleNumber ?? 'Not assigned'}</strong></span><span>Portal role<strong>{roleLabel(selected.role)}</strong></span><span>Account status<strong><Status value={selected.status} /></strong></span><span>Email verification<strong>{selected.emailVerifiedAt ? `Verified ${formatDate(selected.emailVerifiedAt)}` : 'Not verified'}</strong></span><span>Account created<strong>{formatDate(selected.createdAt)}</strong></span></div><div className="sa-profile-actions"><button className="sa-button sa-button-secondary" type="button" disabled={selected.role === 'super_admin'} onClick={() => void revokeSessions(selected)}><LockKeyhole size={14} /> Revoke sessions</button><button className="sa-button sa-button-secondary" type="button" disabled={selected.role === 'super_admin'} onClick={() => void resetPassword(selected)}>Reset credentials</button></div><h3 className="sa-subheading">Account activity</h3>{selectedActivity.isPending ? <LoadingRows /> : selectedActivity.data?.length ? <ol className="sa-timeline">{selectedActivity.data.slice(0, 8).map((event) => <li key={event.id}><span className="sa-timeline-mark"><Activity size={14} /></span><div><strong>{event.action.replaceAll('.', ' ')}</strong><small>{event.targetType} · {event.targetId}</small></div><time>{formatDate(event.createdAt)}</time></li>)}</ol> : <Empty title="No account activity" detail="No administrator actions are recorded for this account." />}</section><section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">INDIVIDUAL ACCESS</span><h2>Permission overrides</h2></div></div><p className="sa-panel-copy">Allow or deny individual permissions, or return to the role default. Every change is audited.</p><AdministratorPermissionOverrides adminId={selected.id} role={selected.role} /></section></>}
        </>}

        {section === 'roles' && <RoleAdministratorGroups roles={roles.data ?? []} administrators={administrators.data ?? []} isPending={roles.isPending || administrators.isPending} isError={roles.isError || administrators.isError} />}
        {section === 'roles' && <><section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">ROLE DIRECTORY</span><h2>Administrator roles</h2></div><Shield size={18} /></div>{roles.isPending ? <LoadingRows /> : roles.isError ? <Empty title="Role directory unavailable" detail={roles.error.message} /> : <div className="sa-role-grid">{roles.data?.map((role) => <article className="sa-role-card" key={role.role}><span className="sa-role-icon"><ShieldCheck size={17} /></span><span className="sa-status sa-status-active">DEFINED</span><h3>{roleLabel(role.role)}</h3><p>{roleDescriptions[role.role] ?? 'Central administrator identity and access role'}</p><div><small>Portal route</small><code>{role.portal}</code></div></article>)}</div>}<div className="sa-capability-note"><LockKeyhole size={16} /><span><strong>Permission assignments are enforced by the API.</strong> Role changes are recorded in the administrator audit log. Super Admin permissions remain immutable.</span></div></section><RolePermissionsEditor roles={roles.data ?? []} /><section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">ACCESS HISTORY</span><h2>Role and permission changes</h2></div><span className="sa-count-chip">{permissionHistory.length} events</span></div>{auditLog.isPending ? <LoadingRows /> : auditLog.isError ? <Empty title="Permission history unavailable" detail={auditLog.error.message} /> : permissionHistory.length ? <ol className="sa-timeline">{permissionHistory.map((event) => <li key={event.id}><span className="sa-timeline-mark"><ShieldCheck size={14} /></span><div><strong>{event.action.replaceAll('.', ' ')}</strong><small>{event.actorName ?? 'Unknown administrator'} · {event.targetType} · {event.targetId}</small></div><time>{formatDate(event.createdAt)}</time></li>)}</ol> : <Empty title="No permission changes recorded" detail="Changes will be recorded here after an authorized role or individual override update." />}</section></>}

        {section === 'systems' && <div className="sa-system-grid"><section className="sa-panel sa-system-card"><div className="sa-system-heading"><span className="sa-system-icon"><Users size={18} /></span><span className={businessOverview.isError ? 'sa-system-state is-error' : 'sa-system-state'}>{businessOverview.isPending ? 'Loading' : businessOverview.isError ? 'Unavailable' : 'Connected'}</span></div><h2>Customer overview</h2><p>Customer totals and growth for {businessOverview.data?.from ?? 'the selected period'} to {businessOverview.data?.to ?? 'today'}.</p>{businessOverview.isPending ? <LoadingRows /> : businessOverview.isError ? <div className="sa-inline-error">{businessOverview.error.message}</div> : <div className="sa-system-metrics"><div><span>Total customers</span><strong>{businessOverview.data?.totalCustomers ?? '—'}</strong></div><div><span>New customers</span><strong>{businessOverview.data?.newCustomers ?? '—'}</strong></div><div><span>Returning customers</span><strong>{businessOverview.data?.returningCustomers ?? '—'}</strong></div></div>}</section>{portalRoles.map((role, index) => { const Icon = [BriefcaseBusiness, CircleDollarSign, Boxes, Megaphone, Package, MonitorCog][index]; const query = systems[index]; const data = query.data as PortalSnapshot | undefined; return <section className="sa-panel sa-system-card" key={role}><div className="sa-system-heading"><span className="sa-system-icon"><Icon size={18} /></span><span className={query.isError ? 'sa-system-state is-error' : 'sa-system-state'}>{query.isPending ? 'Loading' : query.isError ? 'Unavailable' : 'Connected'}</span></div><h2>{roleLabel(role)}</h2><p>{roleDescriptions[role]}</p>{query.isPending ? <LoadingRows /> : query.isError ? <div className="sa-inline-error">{query.error instanceof Error ? query.error.message : 'Portal data unavailable.'}</div> : <><div className="sa-system-metrics">{Object.entries(data?.metrics ?? {}).slice(0, 3).map(([label, value]) => <div key={label}><span>{label.replaceAll(/([A-Z])/g, ' $1')}</span><strong>{typeof value === 'number' && label.toLowerCase().includes('revenue') ? new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(value) : value}</strong></div>)}</div>{data?.series?.length ? <div className="sa-series-list">{data.series.slice(0, 4).map((item) => <div key={item.label}><span>{item.label}</span><div><i style={{ width: `${Math.max(3, item.value / Math.max(...data.series.map((entry) => entry.value), 1) * 100)}%` }} /></div><strong>{item.value}</strong></div>)}</div> : <p className="sa-muted-note">No series data returned.</p>}</>}</section>})}</div>}

        {section === 'security' && <>
          <div className="sa-stat-grid sa-stat-grid-3"><Metric icon={<ShieldCheck size={17} />} label="Successful sign-ins" value={overview.data?.recentLogins.filter((row) => row.success).length} note="Latest 25 recorded attempts" tone="green" /><Metric icon={<ShieldAlert size={17} />} label="Failed sign-ins" value={overview.data?.recentLogins.filter((row) => !row.success).length} note="Latest 25 recorded attempts" tone="amber" /><Metric icon={<LockKeyhole size={17} />} label="Suspended accounts" value={overview.data?.suspended} note="Current account status" tone="blue" /></div>
          <section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">AUTHENTICATION AUDIT</span><h2>Recent sign-in activity</h2></div></div>{overview.isPending ? <LoadingRows /> : <LoginTable rows={overview.data?.recentLogins ?? []} />}</section>
          <section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">SECURITY EVENTS</span><h2>Access and credential events</h2></div><span className="sa-count-chip">{securityEvents.length} matched</span></div>{auditLog.isPending ? <LoadingRows /> : auditLog.isError ? <Empty title="Security event feed unavailable" detail={auditLog.error.message} /> : securityEvents.length ? <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>Event</th><th>Administrator</th><th>Target</th><th>Time</th></tr></thead><tbody>{securityEvents.map((event) => <tr key={event.id}><td>{event.action.replaceAll('.', ' ')}</td><td>{event.actorName ?? 'Unknown administrator'}<small>{event.actorEmail ?? '—'}</small></td><td>{event.targetType} · {event.targetId}</td><td>{formatDate(event.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="No matching security events" detail="No security-related actions were found in the returned audit window." />}</section>
          <section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">SESSION CONTROL</span><h2>Administrator access</h2></div></div><p className="sa-panel-copy">Active session inventory is not exposed by the API. You can revoke all sessions for an account below.</p>{administrators.data?.length ? <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>Administrator</th><th>Status</th><th>Last sign-in</th><th>Action</th></tr></thead><tbody>{administrators.data.map((admin) => <tr key={admin.id}><td><strong>{admin.fullName}</strong><small>{admin.roleNumber ?? admin.email}</small></td><td><Status value={admin.status} /></td><td>{formatDate(admin.lastLoginAt)}</td><td><button className="sa-mini-button" type="button" disabled={admin.role === 'super_admin'} onClick={() => void revokeSessions(admin)}>Revoke sessions</button></td></tr>)}</tbody></table></div> : <Empty title="No administrator accounts" detail="The directory is empty." />}</section>
        </>}

        {section === 'audit' && <section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">LATEST EVENTS</span><h2>Administrator audit log</h2></div><span className="sa-count-chip">{auditLog.data?.length ?? 0} events</span></div>{auditLog.isPending ? <LoadingRows /> : auditLog.isError ? <Empty title="Audit log unavailable" detail={auditLog.error.message} /> : auditLog.data?.length ? <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>Action</th><th>Actor</th><th>Target type</th><th>Target ID</th><th>Timestamp</th></tr></thead><tbody>{auditLog.data.map((event) => <tr key={event.id}><td>{event.action.replaceAll('.', ' ')}</td><td><strong>{event.actorName ?? 'Unknown administrator'}</strong><small>{event.actorEmail ?? '—'}</small></td><td>{event.targetType}</td><td className="sa-mono">{event.targetId}</td><td>{formatDate(event.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="No audit records" detail="No administrator audit events were returned." />}<div className="sa-module-actions"><span>Up to 500 most recent actor-attributed events.</span><button className="sa-button sa-button-secondary" type="button" disabled={!auditLog.data?.length} onClick={downloadAudit}>Export audit CSV <ArrowRight size={14} /></button></div></section>}

        {section === 'reports' && <>
          <section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">BUSINESS PERFORMANCE</span><h2>Executive business report</h2></div><label className="sa-report-period">Period<select value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="last7days">Last 7 days</option><option value="last30days">Last 30 days</option><option value="thisMonth">This month</option><option value="lastMonth">Last month</option><option value="thisYear">This year</option></select></label></div>
            {businessOverview.isPending ? <LoadingRows /> : businessOverview.isError ? <Empty title="Business report unavailable" detail={businessOverview.error.message} /> : <><p className="sa-panel-copy">{businessOverview.data?.from} to {businessOverview.data?.to}. Values are returned by the authorized admin dashboard API.</p><div className="sa-report-metrics">{[
              ['Orders', businessOverview.data?.totalOrders], ['Paid revenue', `KES ${Number(businessOverview.data?.paidRevenue ?? 0).toLocaleString('en-KE')}`], ['Paid orders', businessOverview.data?.paidOrderCount], ['Average order value', `KES ${Number(businessOverview.data?.averageOrderValue ?? 0).toLocaleString('en-KE')}`], ['Pending orders', businessOverview.data?.pendingOrders], ['Customers', businessOverview.data?.totalCustomers], ['New customers', businessOverview.data?.newCustomers], ['Returning customers', businessOverview.data?.returningCustomers], ['Products', businessOverview.data?.totalProducts], ['Inventory units', businessOverview.data?.inventoryUnits], ['Low-stock variants', businessOverview.data?.lowStockVariants], ['Out-of-stock variants', businessOverview.data?.outOfStockVariants],
            ].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</div><div className="sa-module-actions"><span>Business and inventory summaries</span><button className="sa-button sa-button-secondary" type="button" onClick={downloadBusinessReport}>Export business CSV <ArrowRight size={14} /></button></div>{businessOverview.data?.revenueTrend.length ? <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>Settlement date</th><th>Collected revenue (KES)</th></tr></thead><tbody>{businessOverview.data.revenueTrend.map((point) => <tr key={point.date}><td>{point.date}</td><td>{Number(point.revenue).toLocaleString('en-KE')}</td></tr>)}</tbody></table></div> : <p className="sa-muted-note">No revenue trend points were returned for this period.</p>}</>}
          </section>
          <section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">FINANCE</span><h2>Financial summary</h2></div></div>{financialReport.isPending ? <LoadingRows /> : financialReport.isError ? <Empty title="Financial summary unavailable" detail={financialReport.error.message} /> : <><div className="sa-report-metrics sa-finance-metrics">{[['Gross sales', financialReport.data?.grossSales], ['Discounts', financialReport.data?.discounts], ['Collected payments', financialReport.data?.collectedPayments], ['Cost of goods sold', financialReport.data?.costOfGoodsSold ?? 'Unavailable'], ['Operating expenses', financialReport.data?.operatingExpenses], ['Profit calculation', financialReport.data?.profitAvailable ? 'Available' : 'Cost data unavailable']].map(([label, value]) => <div key={String(label)}><span>{label} (KES)</span><strong>{value ?? '—'}</strong></div>)}</div><div className="sa-module-actions"><span>Report endpoint returns lifetime totals; date filtering is not exposed.</span><button className="sa-button sa-button-secondary" type="button" onClick={downloadFinancialReport}>Export finance CSV <ArrowRight size={14} /></button></div></>}</section>
          <div className="sa-report-grid"><Report icon={<Users size={19} />} title="Administrator directory" detail="Export authorized account roles, status, and email verification." disabled={!administrators.data?.length} onClick={downloadAdmins} /><Report icon={<FileText size={19} />} title="Administrator audit" detail="Export the actor-attributed administrator audit feed." disabled={!auditLog.data?.length} onClick={downloadAudit} /><Report icon={<LockKeyhole size={19} />} title="Authentication activity" detail="Export the latest successful and failed administrator sign-ins." disabled={!overview.data?.recentLogins.length} onClick={downloadLogins} /></div>
        </>}
        {section === 'notifications' && <><section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">INTERNAL ALERT FEED</span><h2>Security and administrator alerts</h2></div><span className="sa-count-chip">{internalAlerts.data?.length ?? 0} events</span></div><p className="sa-panel-copy">Read-only feed from persisted monitoring alerts, failed administrator logins, and invitation email delivery status.</p>{internalAlerts.isPending ? <LoadingRows /> : internalAlerts.isError ? <Empty title="Internal alert feed unavailable" detail={internalAlerts.error.message} /> : internalAlerts.data?.length ? <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>Severity</th><th>Alert</th><th>Category</th><th>Status</th><th>Time</th></tr></thead><tbody>{internalAlerts.data.map((alert) => <tr key={alert.id}><td><Status value={alert.severity} /></td><td><strong>{alert.title}</strong><small>{alert.detail}</small></td><td>{alert.category.replaceAll('_', ' ')}</td><td>{alert.status}</td><td>{formatDate(alert.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="No internal alerts" detail="No failed sign-ins, invitation delivery issues, or monitoring alerts were returned." />}</section><section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">CUSTOMER ANNOUNCEMENTS</span><h2>Existing notification campaigns</h2></div><span className="sa-count-chip">{campaigns.data?.length ?? 0} campaigns</span></div><p className="sa-panel-copy">These are customer-facing announcements from the shared admin API, not internal administrator alerts.</p>{campaigns.isPending ? <LoadingRows /> : campaigns.isError ? <Empty title="Campaign list unavailable" detail={campaigns.error.message} /> : campaigns.data?.length ? <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>Campaign</th><th>Audience</th><th>Recipients</th><th>Unread</th><th>Created</th></tr></thead><tbody>{campaigns.data.map((campaign) => <tr key={campaign.id}><td><strong>{campaign.title}</strong><small>{campaign.body}</small></td><td>{campaign.audienceType}{campaign.audienceUserId ? ` · customer ${campaign.audienceUserId}` : ''}</td><td>{campaign.recipientCount}</td><td>{campaign.unreadCount ?? '—'}</td><td>{formatDate(campaign.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="No announcement campaigns" detail="The customer campaign endpoint returned no records." />}</section></>}
        {section === 'settings' && <><section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">SUPER ADMIN PROFILE</span><h2>Signed-in account</h2></div><span className="sa-status sa-status-active">AUTHENTICATED</span></div>{adminProfile.isPending ? <LoadingRows /> : adminProfile.isError ? <Empty title="Profile unavailable" detail={adminProfile.error.message} /> : <div className="sa-profile-grid"><span>Full name<strong>{adminProfile.data?.fullName}</strong></span><span>Email<strong>{adminProfile.data?.email}</strong></span><span>Administrator ID<strong>{adminProfile.data?.id}</strong></span></div>}<div className="sa-module-actions"><span>Profile editing and self-service password change are not available in the current API.</span><button className="sa-button sa-button-secondary" type="button" onClick={() => void signOut()}><LogOut size={14} /> Sign out</button></div></section><section className="sa-panel"><div className="sa-panel-heading"><div><span className="sa-eyebrow">APPLICATION SETTINGS</span><h2>Business contact and checkout settings</h2></div></div><p className="sa-panel-copy">These settings affect the shared application and are audit-logged when saved.</p>{settings.isPending ? <LoadingRows /> : settings.isError ? <Empty title="Settings unavailable" detail={settings.error.message} /> : <form className="sa-settings-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const entries = Array.from(data.entries()).filter(([, value]) => String(value).trim() !== ''); if (entries.length === 0) { setError('Enter at least one non-empty setting to update.'); return }; updateSettings.mutate(Object.fromEntries(entries) as BusinessSettings) }}><label>Business name<input name="businessName" minLength={2} maxLength={120} defaultValue={settings.data?.businessName ?? ''} /></label><label>Tagline<input name="tagline" maxLength={240} defaultValue={settings.data?.tagline ?? ''} /></label><label>Contact email<input name="contactEmail" type="email" maxLength={254} defaultValue={settings.data?.contactEmail ?? ''} /></label><label>Contact phone<input name="contactPhone" maxLength={30} defaultValue={settings.data?.contactPhone ?? ''} /></label><label>WhatsApp number<input name="whatsappNumber" maxLength={30} defaultValue={settings.data?.whatsappNumber ?? ''} /></label><label>Instagram URL<input name="instagramUrl" type="url" maxLength={500} defaultValue={settings.data?.instagramUrl ?? ''} /></label><label>Dispatch town<input name="dispatchTown" maxLength={120} defaultValue={settings.data?.dispatchTown ?? ''} /></label><label>M-Pesa till name<input name="mpesaTillName" maxLength={120} defaultValue={settings.data?.mpesaTillName ?? ''} /></label><label>M-Pesa till number<input name="mpesaTillNumber" inputMode="numeric" maxLength={20} defaultValue={settings.data?.mpesaTillNumber ?? ''} /></label><label>M-Pesa mobile number<input name="mpesaMobileNumber" type="tel" maxLength={13} defaultValue={settings.data?.mpesaMobileNumber ?? ''} /></label><div className="sa-settings-actions"><span>Saving records an administrator audit event.</span><button className="sa-button sa-button-primary" type="submit" disabled={updateSettings.isPending}>{updateSettings.isPending ? 'Saving…' : 'Save application settings'}</button></div></form>}</section><Unavailable icon={<Settings size={20} />} title="System preferences are not connected" detail="The backend does not expose environment, security-policy, or platform preference management through the Super Admin API." /></>}
      </div>
    </section>
  </main>
}

function Metric({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: number | undefined; note: string; tone: string }) {
  return <article className="sa-stat-card"><span className={`sa-stat-icon is-${tone}`}>{icon}</span><span className="sa-stat-label">{label}</span><strong>{value ?? '—'}</strong><small>{note}</small></article>
}

function Report({ icon, title, detail, disabled, onClick }: { icon: ReactNode; title: string; detail: string; disabled?: boolean; onClick: () => void }) {
  return <section className="sa-panel sa-report-card"><span className="sa-report-icon">{icon}</span><h2>{title}</h2><p>{detail}</p><button className="sa-button sa-button-secondary" type="button" disabled={disabled} onClick={onClick}>{title === 'Business summaries' ? 'Review system data' : 'Export CSV'} <ArrowRight size={14} /></button></section>
}

function LoadingRows() {
  return <div className="sa-loading-rows"><i /><i /><i /></div>
}
