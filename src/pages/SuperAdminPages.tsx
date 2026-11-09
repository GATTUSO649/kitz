import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import '../admin-theme.css'
import '../super-admin-auth.css'

type Administrator = { id: number; email: string; fullName: string; roleNumber: string | null; role: string | null; status: string; emailVerifiedAt: string | null; lastLoginAt: string | null; createdAt: string }
type Overview = { total: number; active: number; suspended: number; pending: number; pendingInvitations: number; recentActivity: { action: string; createdAt: string }[]; recentLogins: { id: number; identity: string; success: boolean; failureCode: string | null; createdAt: string }[] }

async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include', headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } })
  if (response.status === 401 && !/\/(?:bootstrap|verify|login)$/.test(path)) window.dispatchEvent(new Event('kitculture:admin-session-expired'))
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? 'Administrator request failed.')
  return payload.data as T
}

const roles = ['it_admin', 'sales_admin', 'finance_admin', 'inventory_admin', 'marketing_admin', 'content_admin', 'second_hand_admin', 'seller_support_admin', 'marketplace_finance_admin', 'marketplace_moderator'] as const
const roleLabels: Record<(typeof roles)[number], string> = { it_admin: 'IT', sales_admin: 'Sales and Customers', finance_admin: 'Finance', inventory_admin: 'Inventory and Logistics', marketing_admin: 'Marketing', content_admin: 'Products and Content', second_hand_admin: 'Second-Hand Admin', seller_support_admin: 'Seller Support Admin', marketplace_finance_admin: 'Marketplace Finance Admin', marketplace_moderator: 'Marketplace Moderator' }
const marketplaceRoles = new Set<string>(['second_hand_admin', 'seller_support_admin', 'marketplace_finance_admin', 'marketplace_moderator'])

function SuperAdminAuthLayout({ eyebrow, title, description, variant, children }: { eyebrow: string; title: string; description?: string; variant: 'login' | 'setup' | 'verification'; children: ReactNode }) {
  return <main className={`sa-auth-shell is-${variant}`}>
    <aside className="sa-auth-aside">
      <a className="sa-auth-brand" href="/" aria-label="MATRIX home"><img src="/matrix-full-logo.png" alt="MATRIX" /></a>
      <div className="sa-auth-aside-copy"><span>ADMINISTRATOR ACCESS</span><h2>One platform.<br />Controlled access.</h2><p>Restricted tools for governing KitCulture administrators and business systems.</p></div>
      <small className="sa-auth-footer">KITCULTURE · SUPER ADMIN</small>
    </aside>
    <section className="sa-auth-stage"><div className="sa-auth-card" key={variant}>
      <span className="sa-auth-eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p className="sa-auth-description">{description}</p>}
      {children}
    </div></section>
  </main>
}

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
      const deliveryError = result.deliveryErrorCode === 'SMTP_AUTH_FAILED'
        ? 'Brevo rejected the SMTP login or key. Check SMTP_USER and SMTP_PASS on the server.'
        : result.deliveryErrorCode === 'SMTP_CONNECTION_FAILED'
          ? 'The server could not connect to Brevo SMTP. Check SMTP_HOST and SMTP_PORT=587.'
          : result.deliveryErrorCode === 'SMTP_RECIPIENT_REJECTED'
            ? 'Brevo rejected the sender or recipient. Verify EMAIL_FROM in Brevo and use a valid recipient address.'
            : 'The verification email was not delivered. Check SMTP configuration and retry delivery.'
      setError(`Account created. ${deliveryError}`)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Super Administrator bootstrap failed.')
    } finally {
      setBusy(false)
    }
  }

  return <SuperAdminAuthLayout variant="setup" eyebrow="ONE-TIME INITIALIZATION" title="Initialize Super Administrator" description="Create the primary administrator account and verify its email address.">
    {deliveryMessage ? <div className="sa-auth-result is-success"><p>{deliveryMessage}</p><button className="sa-auth-submit" type="button" onClick={() => navigate('/super-admin/login', { replace: true })}>Continue to sign in</button></div> : <form className="sa-auth-form" onSubmit={(event) => void submit(event)}>
      <label>Full name<input name="fullName" required minLength={2} maxLength={160} autoComplete="name" /></label>
      <label>Email address<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      <div className="sa-auth-form-row"><label>Password<input name="password" type="password" autoComplete="new-password" required minLength={14} maxLength={128} /></label><label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={14} maxLength={128} /></label></div>
      <label>Bootstrap secret key<input name="secretKey" type="password" autoComplete="off" required minLength={32} maxLength={512} /></label>
      {error && <p className="sa-auth-error" role="alert">{error}</p>}
      <button className="sa-auth-submit" type="submit" disabled={busy}>{busy ? 'Initializing account…' : 'Initialize Super Administrator'}</button>
    </form>}
  </SuperAdminAuthLayout>
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

  return <SuperAdminAuthLayout variant="login" eyebrow="SUPER ADMINISTRATOR" title="Secure sign in" description="Use the email address or role number assigned to your account.">
    <form className="sa-auth-form" onSubmit={(event) => void signIn(event)}>
      <label>Email or role number<input value={identity} onChange={(event) => setIdentity(event.target.value)} autoComplete="username" required /></label>
      <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
      {error && <p className="sa-auth-error" role="alert">{error}</p>}
      <button className="sa-auth-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
      <a className="sa-auth-back" href="/">Return to KitCulture</a>
    </form>
  </SuperAdminAuthLayout>
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

  return <SuperAdminAuthLayout variant="verification" eyebrow="EMAIL VERIFICATION" title={error || !token ? 'Verification failed' : 'Verifying Super Administrator account…'} description={error ? undefined : 'Confirming your administrator account. This page will continue when verification is complete.'}>
    {error && <p className="sa-auth-error" role="alert">{error}</p>}
  </SuperAdminAuthLayout>
}

export function SuperAdminRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'administrators' | 'security'>('overview')
  const dashboardPage = !['/super-admin/signup', '/super-admin/login', '/super-admin/verify'].includes(location.pathname)
  const session = useQuery({ queryKey: ['super-admin', 'session'], queryFn: () => adminApi<{ user: { role: string | null } }>('/api/v1/admin/me'), enabled: dashboardPage, staleTime: 0, refetchOnMount: 'always', retry: false })
  const authorized = session.data?.user.role === 'super_admin'
  const overview = useQuery({ queryKey: ['super-admin', 'overview'], queryFn: () => adminApi<Overview>('/api/v1/admin/ecosystem'), enabled: dashboardPage && authorized, retry: false, refetchInterval: 30_000 })
  const administrators = useQuery({ queryKey: ['super-admin', 'administrators'], queryFn: () => adminApi<Administrator[]>('/api/v1/admin/ecosystem/administrators'), enabled: dashboardPage && authorized, retry: false })

  const invite = useMutation({ mutationFn: (input: { fullName: string; email: string; role: string }) => adminApi<{ id: number; roleNumber: string; deliveryStatus: string }>('/api/v1/admin/ecosystem/administrators/invite', { method: 'POST', body: JSON.stringify(input) }), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['super-admin', 'administrators'] }), queryClient.invalidateQueries({ queryKey: ['super-admin', 'overview'] })]) }, onError: (issue) => setError(issue instanceof Error ? issue.message : 'Invitation could not be created.') })
  const updateRole = async (id: number, role: string) => {
    setError('')
    try { await adminApi(`/api/v1/admin/ecosystem/administrators/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }); await queryClient.invalidateQueries({ queryKey: ['super-admin', 'administrators'] }) }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Role could not be changed.') }
  }
  const updateStatus = async (id: number, action: 'activate' | 'suspend' | 'disable' | 'reject') => {
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

  useEffect(() => {
    if (!dashboardPage || session.isPending || session.isFetching || session.isError || !authorized) return
    const clearAndRedirect = () => {
      queryClient.removeQueries({ queryKey: ['super-admin'] })
      navigate('/super-admin/login', { replace: true })
    }
    const expireSession = () => clearAndRedirect()
    const idleTimeoutMs = 20 * 60_000
    const keepAliveThrottleMs = 30_000
    let idleTimer = 0
    let lastKeepAlive = Date.now()
    let signingOut = false
    const logout = () => {
      if (signingOut) return
      signingOut = true
      void adminApi('/api/v1/admin/logout', { method: 'POST' }).catch(() => undefined).finally(clearAndRedirect)
    }
    const recordActivity = () => {
      if (signingOut) return
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(logout, idleTimeoutMs)
      const now = Date.now()
      if (now - lastKeepAlive < keepAliveThrottleMs) return
      lastKeepAlive = now
      void adminApi('/api/v1/admin/session/activity', { method: 'POST' }).catch(() => undefined)
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
  }, [authorized, dashboardPage, navigate, queryClient, session.isError, session.isFetching, session.isPending])

  async function signOut() {
    try { await adminApi('/api/v1/admin/logout', { method: 'POST' }) } catch { /* The local session is discarded either way. */ }
    queryClient.removeQueries({ queryKey: ['super-admin'] })
    navigate('/super-admin/login', { replace: true })
  }

  if (location.pathname === '/super-admin/login') return <SuperAdminLoginPage />
  if (location.pathname === '/super-admin/verify') return <SuperAdminVerifyPage />
  if (location.pathname === '/super-admin/signup') return <SuperAdminSignupPage />
  if (session.isPending || session.isFetching) return <main className="role-portal-auth-check" role="status">Verifying administrator access...</main>
  if (session.isError || !authorized) return <Navigate to="/super-admin/login" replace />
  if (overview.isError) return <main className="admin-empty admin-error"><strong>Super Administrator access unavailable</strong><span>{overview.error.message}</span></main>

  return <main className="admin-it-page super-admin-page">
    <aside className="super-admin-sidebar">
      <span className="admin-kicker">KITCULTURE</span><strong>Super Admin</strong>
      <nav><button type="button" className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>Executive overview</button><button type="button" className={activeTab === 'administrators' ? 'active' : ''} onClick={() => setActiveTab('administrators')}>Administrators</button><button type="button" className={activeTab === 'security' ? 'active' : ''} onClick={() => setActiveTab('security')}>Security and sessions</button></nav>
      <button className="admin-it-button" type="button" onClick={() => void signOut()}>Sign out</button>
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
        <section className="admin-it-panel"><header><div><span className="admin-kicker">IDENTITIES</span><h3>Administrators</h3></div></header>{administrators.isPending ? <div className="admin-empty">Loading administrators…</div> : administrators.isError ? <div className="admin-empty admin-error">{administrators.error.message}</div> : <div className="admin-it-table-wrap"><table className="admin-it-table"><thead><tr><th>Administrator</th><th>Role number</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{administrators.data?.map((admin) => <tr key={admin.id}><td><strong>{admin.fullName}</strong><br /><small>{admin.email}</small></td><td>{admin.roleNumber ?? 'Pending allocation'}</td><td><select aria-label={`Role for ${admin.fullName}`} value={admin.role ?? ''} disabled={admin.role === 'super_admin'} onChange={(event) => void updateRole(admin.id, event.target.value)}>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></td><td>{admin.status}{marketplaceRoles.has(admin.role ?? '') && admin.emailVerifiedAt && admin.status === 'pending' ? ' · awaiting approval' : ''}</td><td><div className="admin-it-actions">{marketplaceRoles.has(admin.role ?? '') && admin.emailVerifiedAt && ['pending', 'rejected'].includes(admin.status) ? <><button type="button" onClick={() => void updateStatus(admin.id, 'activate')}>{admin.status === 'rejected' ? 'Reapprove' : 'Approve'}</button>{admin.status === 'pending' && <button type="button" onClick={() => void updateStatus(admin.id, 'reject')}>Reject</button>}</> : admin.status === 'pending' ? <button type="button" onClick={async () => { try { await adminApi(`/api/v1/admin/ecosystem/administrators/${admin.id}/invitation/resend`, { method: 'POST', body: '{}' }); setError('Invitation resend queued.') } catch (issue) { setError(issue instanceof Error ? issue.message : 'Invitation could not be resent.') } }}>Resend invitation</button> : admin.status === 'suspended' ? <button type="button" onClick={() => void updateStatus(admin.id, 'activate')}>Reactivate</button> : admin.status === 'active' && admin.role !== 'super_admin' ? <><button type="button" onClick={() => void updateStatus(admin.id, 'suspend')}>Suspend</button><button type="button" onClick={() => void updateStatus(admin.id, 'disable')}>Disable</button></> : null}<button type="button" disabled={admin.role === 'super_admin'} onClick={async () => { const password = window.prompt('Enter a replacement password of at least 14 characters'); if (!password) return; try { await adminApi(`/api/v1/admin/ecosystem/administrators/${admin.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }); setError('Credentials reset and administrator sessions revoked.') } catch (issue) { setError(issue instanceof Error ? issue.message : 'Credentials could not be reset.') } }}>Reset credentials</button></div></td></tr>)}</tbody></table></div>}</section>
      </>}
    </section>
  </main>
}
