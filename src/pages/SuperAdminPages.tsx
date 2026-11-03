import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import '../admin-theme.css'

type Administrator = { id: number; email: string; fullName: string; roleNumber: string | null; role: string | null; status: string; emailVerifiedAt: string | null; lastLoginAt: string | null; createdAt: string }
type Overview = { total: number; active: number; suspended: number; pending: number; pendingInvitations: number; recentActivity: { action: string; createdAt: string }[]; recentLogins: { id: number; identity: string; success: boolean; failureCode: string | null; createdAt: string }[] }

async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include', headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } })
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? 'Administrator request failed.')
  return payload.data as T
}

const roles = ['it_admin', 'sales_admin', 'finance_admin', 'inventory_admin', 'marketing_admin', 'content_admin'] as const
const roleLabels: Record<(typeof roles)[number], string> = { it_admin: 'IT', sales_admin: 'Sales and Customers', finance_admin: 'Finance', inventory_admin: 'Inventory and Logistics', marketing_admin: 'Marketing', content_admin: 'Products and Content' }

export function SuperAdminSignupPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [deliveryMessage, setDeliveryMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setDeliveryMessage('')
    const form = new FormData(event.currentTarget)
    if (String(form.get('password')) !== String(form.get('confirmPassword'))) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const result = await adminApi<{ pendingVerification?: boolean; deliveryStatus?: string; deliveryErrorCode?: string }>('/api/v1/admin/bootstrap', { method: 'POST', body: JSON.stringify({ fullName: form.get('fullName'), email: form.get('email'), password: form.get('password'), confirmPassword: form.get('confirmPassword'), secretKey: form.get('secretKey') }) })
      if (result.deliveryStatus === 'accepted') {
        setDeliveryMessage('Super Administrator account created. Check the supplied email address for the verification link.')
        return
      }
      setError(`Account created, but the verification email was not delivered (${result.deliveryErrorCode ?? result.deliveryStatus ?? 'delivery failed'}). Configure SMTP or the email provider and retry delivery.`)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Super Administrator bootstrap failed.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="admin-login-page"><section className="admin-login-card"><span className="admin-kicker">ONE-TIME INITIALIZATION</span><h1>Initialize Super Administrator</h1>{deliveryMessage ? <><p className="admin-success">{deliveryMessage}</p><button className="button button-green" type="button" onClick={() => navigate('/super-admin/login', { replace: true })}>Continue to Super Administrator login</button></> : <form onSubmit={(event) => void submit(event)}><label>Full name<input name="fullName" required minLength={2} maxLength={160} /></label><label>Email<input name="email" type="email" required maxLength={254} /></label><label>Password<input name="password" type="password" autoComplete="new-password" required minLength={14} maxLength={128} /></label><label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={14} maxLength={128} /></label><label>ADMIN_SECRET_KEY<input name="secretKey" type="password" autoComplete="off" required minLength={32} maxLength={512} /></label>{error && <p className="admin-error" role="alert">{error}</p>}<button className="button button-green" type="submit" disabled={busy}>{busy ? 'Initializing…' : 'Initialize Super Administrator'}</button></form>}</section></main>
}

export function SuperAdminLoginPage() {
  const navigate = useNavigate()
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await adminApi<{ portal: string }>('/api/v1/admin/super-admin/login', { method: 'POST', body: JSON.stringify({ identity, password }) })
      navigate('/super-admin/dashboard', { replace: true })
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Super Administrator sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="admin-login-page"><section className="admin-login-card"><span className="admin-kicker">SUPER ADMINISTRATOR</span><h1>Secure sign in</h1><p>Use the email or role number assigned to the Super Administrator account.</p><form onSubmit={(event) => void signIn(event)}><label>Role number or email<input value={identity} onChange={(event) => setIdentity(event.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p className="admin-error" role="alert">{error}</p>}<button className="button button-green" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></section></main>
}

export function SuperAdminVerifyPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const token = new URLSearchParams(location.search).get('token')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) {
      setError('The verification link is missing its token.')
      return
    }
    let active = true
    void adminApi('/api/v1/admin/verify', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => { if (active) navigate('/super-admin/login?verified=1', { replace: true }) })
      .catch((issue: unknown) => { if (active) setError(issue instanceof Error ? issue.message : 'Super Administrator verification failed.') })
    return () => { active = false }
  }, [navigate, token])

  return <main className="admin-login-page"><section className="admin-login-card"><span className="admin-kicker">EMAIL VERIFICATION</span><h1>{error || !token ? 'Verification failed' : 'Verifying Super Administrator account…'}</h1>{error && <p className="admin-error" role="alert">{error}</p>}</section></main>
}

export function SuperAdminRoute() {
  const location = useLocation()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'administrators' | 'security'>('overview')
  const dashboardPage = !['/super-admin/signup', '/super-admin/login', '/super-admin/verify', '/admin/register'].includes(location.pathname)
  const overview = useQuery({ queryKey: ['super-admin', 'overview'], queryFn: () => adminApi<Overview>('/api/v1/admin/ecosystem'), enabled: dashboardPage, retry: false, refetchInterval: 30_000 })
  const administrators = useQuery({ queryKey: ['super-admin', 'administrators'], queryFn: () => adminApi<Administrator[]>('/api/v1/admin/ecosystem/administrators'), enabled: dashboardPage, retry: false })

  const invite = useMutation({ mutationFn: (input: { fullName: string; email: string; role: string }) => adminApi<{ id: number; roleNumber: string; deliveryStatus: string }>('/api/v1/admin/ecosystem/administrators/invite', { method: 'POST', body: JSON.stringify(input) }), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['super-admin', 'administrators'] }), queryClient.invalidateQueries({ queryKey: ['super-admin', 'overview'] })]) }, onError: (issue) => setError(issue instanceof Error ? issue.message : 'Invitation could not be created.') })
  const updateRole = async (id: number, role: string) => {
    setError('')
    try { await adminApi(`/api/v1/admin/ecosystem/administrators/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }); await queryClient.invalidateQueries({ queryKey: ['super-admin', 'administrators'] }) }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Role could not be changed.') }
  }
  const updateStatus = async (id: number, action: 'activate' | 'suspend' | 'disable') => {
    setError('')
    try { await adminApi(`/api/v1/admin/ecosystem/administrators/${id}/status`, { method: 'POST', body: JSON.stringify({ action }) }); await Promise.all([queryClient.invalidateQueries({ queryKey: ['super-admin', 'administrators'] }), queryClient.invalidateQueries({ queryKey: ['super-admin', 'overview'] })]) }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Account status could not be changed.') }
  }

  function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    invite.mutate({ fullName: String(form.get('fullName')), email: String(form.get('email')), role: String(form.get('role')) })
    event.currentTarget.reset()
  }

  if (location.pathname === '/super-admin/login') return <SuperAdminLoginPage />
  if (location.pathname === '/super-admin/verify') return <SuperAdminVerifyPage />
  if (location.pathname === '/super-admin/signup' || location.pathname === '/admin/register') return <SuperAdminSignupPage />
  if (overview.isError && overview.error instanceof Error && overview.error.message.includes('sign in')) return <main className="admin-empty"><strong>Super Administrator sign in required</strong><a href="/super-admin/login">Sign in</a></main>
  if (overview.isError) return <main className="admin-empty admin-error"><strong>Super Administrator access unavailable</strong><span>{overview.error.message}</span></main>

  return <main className="admin-it-page super-admin-page">
    <aside className="super-admin-sidebar">
      <span className="admin-kicker">KITCULTURE</span><strong>Super Admin</strong>
      <nav><button type="button" className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>Executive overview</button><button type="button" className={activeTab === 'administrators' ? 'active' : ''} onClick={() => setActiveTab('administrators')}>Administrators</button><button type="button" className={activeTab === 'security' ? 'active' : ''} onClick={() => setActiveTab('security')}>Security and sessions</button></nav>
    </aside>
    <section className="super-admin-main">
      <header><div><span className="admin-kicker">RESTRICTED ECOSYSTEM</span><h1>Super Administrator</h1></div></header>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {activeTab === 'overview' ? <>
        <div className="admin-it-stat-grid">
          {[['Administrators', overview.data?.total], ['Active', overview.data?.active], ['Suspended', overview.data?.suspended], ['Pending verification', overview.data?.pending], ['Pending invitations', overview.data?.pendingInvitations]].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{overview.isPending ? 'Loading' : value ?? 'Unavailable'}</strong></article>)}
        </div>
        <section className="admin-it-panel"><header><div><span className="admin-kicker">ADMINISTRATOR ACTIVITY</span><h3>Recent audit events</h3></div></header>{overview.data?.recentActivity.length ? <ul>{overview.data.recentActivity.map((event, index) => <li key={`${event.action}-${index}`}><strong>{event.action}</strong><span>{new Date(event.createdAt).toLocaleString()}</span></li>)}</ul> : <div className="admin-empty">No administrative activity has been recorded.</div>}</section>
        <section className="admin-it-panel"><header><div><span className="admin-kicker">AUTHENTICATION</span><h3>Recent login attempts</h3></div></header>{overview.data?.recentLogins.length ? <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr><th>Identity</th><th>Result</th><th>Failure</th><th>Time</th></tr></thead><tbody>{overview.data.recentLogins.map((attempt) => <tr key={attempt.id}><td>{attempt.identity}</td><td>{attempt.success ? 'Success' : 'Failed'}</td><td>{attempt.failureCode ?? '—'}</td><td>{new Date(attempt.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="admin-empty">No login attempts recorded.</div>}</section>
      </> : activeTab === 'security' ? <>
        <section className="admin-it-panel"><header><div><span className="admin-kicker">ACTIVE ACCESS</span><h3>Authentication and session controls</h3></div></header>{administrators.data?.length ? <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr><th>Administrator</th><th>Status</th><th>Last sign in</th><th>Actions</th></tr></thead><tbody>{administrators.data.map((admin) => <tr key={admin.id}><td><strong>{admin.fullName}</strong><br /><small>{admin.roleNumber}</small></td><td>{admin.status}</td><td>{admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : 'Never'}</td><td><div className="admin-it-actions"><button type="button" disabled={admin.role === 'super_admin'} onClick={async () => { try { await adminApi(`/api/v1/admin/ecosystem/administrators/${admin.id}/sessions/revoke`, { method: 'POST', body: '{}' }); setError('Administrator sessions revoked.') } catch (issue) { setError(issue instanceof Error ? issue.message : 'Sessions could not be revoked.') } }}>Revoke sessions</button></div></td></tr>)}</tbody></table></div> : <div className="admin-empty">No administrator accounts are available.</div>}</section>
        <section className="admin-it-panel"><header><div><span className="admin-kicker">LOGIN AUDIT</span><h3>Authentication attempts</h3></div></header><div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr><th>Identity</th><th>Result</th><th>Failure</th><th>Time</th></tr></thead><tbody>{overview.data?.recentLogins.map((attempt) => <tr key={attempt.id}><td>{attempt.identity}</td><td>{attempt.success ? 'Success' : 'Failed'}</td><td>{attempt.failureCode ?? '—'}</td><td>{new Date(attempt.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div></section>
      </> : <>
        <section className="admin-it-panel"><header><div><span className="admin-kicker">CREATE ADMINISTRATOR</span><h3>Invite an administrator</h3></div></header><form className="super-admin-invite" onSubmit={submitInvitation}><label>Full name<input name="fullName" required maxLength={160} /></label><label>Email<input name="email" type="email" required maxLength={254} /></label><label>Role<select name="role">{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><button type="submit" disabled={invite.isPending}>{invite.isPending ? 'Creating…' : 'Create invitation'}</button></form>{invite.data && <p className="admin-success">Role number {invite.data.roleNumber} · delivery {invite.data.deliveryStatus}</p>}</section>
        <section className="admin-it-panel"><header><div><span className="admin-kicker">IDENTITIES</span><h3>Administrators</h3></div></header>{administrators.isPending ? <div className="admin-empty">Loading administrators…</div> : administrators.isError ? <div className="admin-empty admin-error">{administrators.error.message}</div> : <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr><th>Administrator</th><th>Role number</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{administrators.data?.map((admin) => <tr key={admin.id}><td><strong>{admin.fullName}</strong><br /><small>{admin.email}</small></td><td>{admin.roleNumber ?? 'Pending allocation'}</td><td><select aria-label={`Role for ${admin.fullName}`} value={admin.role ?? ''} disabled={admin.role === 'super_admin'} onChange={(event) => void updateRole(admin.id, event.target.value)}>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></td><td>{admin.status}</td><td><div className="admin-it-actions">{admin.status === 'pending' && <button type="button" onClick={async () => { try { await adminApi(`/api/v1/admin/ecosystem/administrators/${admin.id}/invitation/resend`, { method: 'POST', body: '{}' }); setError('Invitation resend queued.') } catch (issue) { setError(issue instanceof Error ? issue.message : 'Invitation could not be resent.') } }}>Resend invitation</button>}{admin.status === 'suspended' ? <button type="button" onClick={() => void updateStatus(admin.id, 'activate')}>Activate</button> : admin.role !== 'super_admin' && <><button type="button" onClick={() => void updateStatus(admin.id, 'suspend')}>Suspend</button><button type="button" onClick={() => void updateStatus(admin.id, 'disable')}>Disable</button></>}<button type="button" disabled={admin.role === 'super_admin'} onClick={async () => { const password = window.prompt('Enter a replacement password of at least 14 characters'); if (!password) return; try { await adminApi(`/api/v1/admin/ecosystem/administrators/${admin.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }); setError('Credentials reset and administrator sessions revoked.') } catch (issue) { setError(issue instanceof Error ? issue.message : 'Credentials could not be reset.') } }}>Reset credentials</button></div></td></tr>)}</tbody></table></div>}</section>
      </>}
    </section>
  </main>
}
