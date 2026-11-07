import { useEffect, useState, type FormEvent } from 'react'
import { Activity, ArrowRight, BadgeDollarSign, Box, ChevronDown, CircleAlert, CreditCard, Eye, EyeOff, LayoutDashboard, LockKeyhole, LogOut, Mail, MapPin, Plus, Search, Settings, ShieldCheck, Tag, Tags } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

type AdminUser = { id: string; email: string; role: string; permissions: string[] }
type Listing = { reference: string; title: string; status: string; priceKes: number; category: string; county: string; town: string }
type MarketplaceSellerAccount = { id: string; email: string; status: 'pending' | 'active' | 'suspended'; emailVerifiedAt: string | null; createdAt: string; sellerName: string | null; town: string | null; county: string | null }
type Category = { id: string; name: string; slug: string; active: boolean; sortOrder: number }
type Payment = { reference: string; purpose: string; amountKes: number; status: string; createdAt: string; providerReceipt: string | null; transactionAt: string | null; verifiedAt: string | null; listingReference: string | null }
type PaymentPagination = { page: number; limit: number; total: number; hasMore: boolean }
type ListingReport = { id: string; reference: string; title: string; reason: string; details: string | null; reporterEmail: string | null; status: string; createdAt: string }
type FeeSettings = { publicationFeeBasisPoints: number; contactUnlockFeeBasisPoints: number; listingExpiryDays: number }
type FooterSocialSettings = { facebookUrl: string; xUrl: string; youtubeUrl: string; whatsappPhone: string }
type Dashboard = { listings: { total: number; published: number; pendingPayment: number; sold: number; expired: number; suspended: number }; payments: { successful: number; failed: number; pending: number; ambiguous: number }; reports: { open: number }; revenueKes?: { publication: number; contactUnlock: number }; recentListings: Listing[] }

const adminApi = '/api/v1/admin/marketplace'
const kitzAdminOrigin = import.meta.env.VITE_KITZ_ORIGIN || 'https://kitz.onrender.com'
const kes = (value: number) => `KSh ${new Intl.NumberFormat('en-KE').format(value)}`

export function MarketplaceAdminPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [paymentPage, setPaymentPage] = useState(1)
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('')
  const [paymentPurposeFilter, setPaymentPurposeFilter] = useState('')
  const [paymentPagination, setPaymentPagination] = useState<PaymentPagination | null>(null)
  const [reports, setReports] = useState<ListingReport[]>([])
    const [sellerAccounts, setSellerAccounts] = useState<MarketplaceSellerAccount[]>([])
  const [feeSettings, setFeeSettings] = useState<FeeSettings>({ publicationFeeBasisPoints: 1_000, contactUnlockFeeBasisPoints: 500, listingExpiryDays: 7 })
  const [footerSocialSettings, setFooterSocialSettings] = useState<FooterSocialSettings>({ facebookUrl: '', xUrl: '', youtubeUrl: '', whatsappPhone: '' })
  const [categories, setCategories] = useState<Category[]>([])
  const [notice, setNotice] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [categoryError, setCategoryError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [listingSearchInput, setListingSearchInput] = useState('')
  const [listingSearch, setListingSearch] = useState('')
  const isLogin = window.location.pathname.endsWith('/login')
  const isActivate = window.location.pathname.endsWith('/activate')
  const isVerify = window.location.pathname.endsWith('/verify')
  const verificationToken = searchParams.get('token') ?? ''
  const section = searchParams.get('section') ?? 'dashboard'

  useEffect(() => {
    if (isLogin || isActivate || isVerify || section === 'admins') return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const load = async () => {
      const sessionResponse = await fetch(`${adminApi}/session`, { signal: controller.signal })
      const session = await sessionResponse.json() as { data?: AdminUser; error?: { message?: string } }
      if (!sessionResponse.ok || !session.data) throw new Error(session.error?.message ?? 'Sign in to continue.')
      setAdmin(session.data)
      const listingQuery = new URLSearchParams({ limit: '50' })
      if (listingSearch.trim()) listingQuery.set('q', listingSearch.trim())
      const paymentQuery = new URLSearchParams({ page: String(paymentPage) })
      if (paymentStatusFilter) paymentQuery.set('status', paymentStatusFilter)
      if (paymentPurposeFilter) paymentQuery.set('purpose', paymentPurposeFilter)
      const endpoint = section === 'listings' ? `${adminApi}/listings?${listingQuery}`
        : section === 'payments' ? `${adminApi}/payments?${paymentQuery}`
          : section === 'reports' ? `${adminApi}/reports?status=open`
            : section === 'sellers' ? `${adminApi}/seller-accounts`
              : section === 'settings' ? `${adminApi}/settings/fees`
                : section === 'categories' ? `${adminApi}/categories`
                  : `${adminApi}/dashboard`
      const response = await fetch(endpoint, { signal: controller.signal })
      const result = await response.json() as { data?: Dashboard | Listing[] | Payment[] | ListingReport[] | MarketplaceSellerAccount[] | Category[] | FeeSettings | FooterSocialSettings; pagination?: PaymentPagination; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Marketplace data could not be loaded.')
      if (section === 'listings') setListings(result.data as Listing[])
      else if (section === 'payments') { setPayments(result.data as Payment[]); setPaymentPagination(result.pagination ?? null) }
      else if (section === 'reports') setReports(result.data as ListingReport[])
      else if (section === 'sellers') setSellerAccounts(result.data as MarketplaceSellerAccount[])
      else if (section === 'settings') {
        setFeeSettings(result.data as FeeSettings)
        const socialResponse = await fetch(`${adminApi}/settings/footer-social-links`, { signal: controller.signal })
        const socialResult = await socialResponse.json() as { data?: Partial<FooterSocialSettings>; error?: { message?: string } }
        if (!socialResponse.ok || !socialResult.data) throw new Error(socialResult.error?.message ?? 'Footer social links could not be loaded.')
        setFooterSocialSettings({
          facebookUrl: socialResult.data.facebookUrl ?? '',
          xUrl: socialResult.data.xUrl ?? '',
          youtubeUrl: socialResult.data.youtubeUrl ?? '',
          whatsappPhone: socialResult.data.whatsappPhone ?? '',
        })
      }
      else if (section === 'categories') setCategories(result.data as Category[])
      else setDashboard(result.data as Dashboard)
    }
    load().catch((reason: unknown) => {
      if (controller.signal.aborted) return
      const message = reason instanceof Error ? reason.message : 'Marketplace administration is unavailable.'
      if (message === 'Sign in to continue.') navigate('/admin/marketplace/login', { replace: true })
      else setError(message)
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [isLogin, isActivate, isVerify, listingSearch, navigate, paymentPage, paymentPurposeFilter, paymentStatusFilter, section])

  function searchListings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setListingSearch(listingSearchInput.trim())
    if (section !== 'listings') navigate('/admin/marketplace/dashboard?section=listings')
  }

  async function updateSellerStatus(account: MarketplaceSellerAccount) {
    const status = account.status === 'active' ? 'suspended' : 'active'
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${adminApi}/seller-accounts/${account.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Seller status could not be updated.')
      setSellerAccounts((current) => current.map((item) => item.id === account.id ? { ...item, status } : item))
      setNotice(status === 'suspended' ? 'Seller account suspended and sessions revoked.' : 'Seller account reactivated.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Seller status could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${adminApi}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const result = await response.json() as { data?: { activationRequired?: boolean; activationToken?: string; roleNumber?: string; email?: string }; error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Sign in failed.')
      if (result.data?.activationRequired && result.data.activationToken && result.data.roleNumber && result.data.email) {
        const activationUrl = new URL('/admin/activate', kitzAdminOrigin)
        activationUrl.searchParams.set('token', result.data.activationToken)
        activationUrl.searchParams.set('roleNumber', result.data.roleNumber)
        activationUrl.searchParams.set('email', result.data.email)
        window.location.assign(activationUrl.toString())
        return
      }
      setPassword('')
      navigate('/admin/marketplace/dashboard', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  async function activateAdminInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${adminApi}/invitations/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken, password, confirmPassword }) })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Invitation verification failed.')
      setNotice('Password saved. Check your email and open the verification link to activate your account.')
      setPassword('')
      setConfirmPassword('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Invitation verification failed.')
    } finally {
      setBusy(false)
    }
  }

  async function verifyAdminEmail() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${adminApi}/invitations/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken }) })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Email verification failed.')
      setNotice('Email verified. Your Second-hand admin account is active and ready to use.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Email verification failed.')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    await fetch(`${adminApi}/logout`, { method: 'POST' })
    navigate('/admin/marketplace/login', { replace: true })
  }

  async function changeListingStatus(reference: string, status: 'suspended' | 'published' | 'sold' | 'removed') {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${adminApi}/listings/${reference}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Listing update failed.')
      setListings((current) => current.map((item) => item.reference === reference ? { ...item, status } : item))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Listing update failed.')
    } finally {
      setBusy(false)
    }
  }

  async function reconcilePayment(reference: string) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${adminApi}/payments/${reference}/reconcile`, { method: 'POST' })
      const result = await response.json() as { data?: { status: string }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Payment reconciliation failed.')
      setPayments((current) => current.map((payment) => payment.reference === reference ? { ...payment, status: result.data!.status } : payment))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Payment reconciliation failed.')
    } finally {
      setBusy(false)
    }
  }

  function exportPaymentsCsv() {
    const columns: { label: string; value: (payment: Payment) => string }[] = [
      { label: 'Payment reference', value: (payment) => payment.reference },
      { label: 'Purpose', value: (payment) => payment.purpose },
      { label: 'Listing reference', value: (payment) => payment.listingReference ?? '' },
      { label: 'Amount KES', value: (payment) => String(payment.amountKes) },
      { label: 'Status', value: (payment) => payment.status },
      { label: 'M-Pesa receipt', value: (payment) => payment.providerReceipt ?? '' },
      { label: 'Transaction time', value: (payment) => payment.transactionAt ?? '' },
      { label: 'Verified at', value: (payment) => payment.verifiedAt ?? '' },
      { label: 'Created at', value: (payment) => payment.createdAt },
    ]
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`
    const csv = [columns.map((column) => escape(column.label)).join(','), ...payments.map((payment) => columns.map((column) => escape(column.value(payment))).join(','))].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `markethub-payments-page-${paymentPage}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function updateReport(id: string, status: 'reviewed' | 'resolved' | 'dismissed') {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${adminApi}/reports/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Report could not be updated.')
      setReports((current) => current.filter((report) => report.id !== id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Report could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  async function saveFees(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${adminApi}/settings/fees`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(feeSettings) })
      const result = await response.json() as { data?: FeeSettings; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Fee settings could not be saved.')
      setFeeSettings(result.data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Fee settings could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function saveFooterSocialSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${adminApi}/settings/footer-social-links`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(footerSocialSettings),
      })
      const result = await response.json() as { data?: Partial<FooterSocialSettings>; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Footer social links could not be saved.')
      setFooterSocialSettings({
        facebookUrl: result.data.facebookUrl ?? '',
        xUrl: result.data.xUrl ?? '',
        youtubeUrl: result.data.youtubeUrl ?? '',
        whatsappPhone: result.data.whatsappPhone ?? '',
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Footer social links could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleCategory(category: Category) {
    const response = await fetch(`${adminApi}/categories/${category.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !category.active }) })
    const result = await response.json() as { data?: Category; error?: { message?: string } }
    if (!response.ok || !result.data) {
      setCategoryError(result.error?.message ?? 'Category could not be updated.')
      return
    }
    setCategories((current) => current.map((item) => item.id === category.id ? result.data! : item))
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const slug = categoryName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    setCategoryError('')
    const response = await fetch(`${adminApi}/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: categoryName, slug }) })
    const result = await response.json() as { data?: Category; error?: { message?: string } }
    if (!response.ok || !result.data) {
      setCategoryError(result.error?.message ?? 'Category could not be created.')
      return
    }
    setCategories((current) => [...current, result.data!].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)))
    setCategoryName('')
  }

  if (isActivate || isVerify) return <div className="admin-login-page admin-invitation-page">
    <Link to="/" className="admin-login-brand"><Tag size={56} strokeWidth={2.2} /><span><strong><em>Market</em>Hub</strong><small>Buy · Sell · Reuse · Save</small></span></Link>
    <main><span className="admin-eyebrow">KITCULTURE ADMINISTRATOR ACCESS</span><h1>Continue through Kitz</h1><p>Marketplace administrator invitations and verification are managed by KitCulture Super Admin.</p><a className="admin-login-submit" href={`${kitzAdminOrigin}/admin/access`}>Open administrator access</a></main>
  </div>

  if (isLogin) return <div className="admin-login-page">
    <Link to="/" className="admin-login-brand"><Tag size={56} strokeWidth={2.2} /><span><strong><em>Market</em>Hub</strong><small>Buy · Sell · Reuse · Save</small></span></Link>
    <main>
      <span className="admin-eyebrow">MARKETPLACE ADMINISTRATION</span>
      <h1>Welcome back</h1>
      <p>Sign in to manage second-hand marketplace operations.</p>
      <p>First-time sign-in: use your assigned role number as the temporary password to set a private password and verify your email.</p>
      {error && <div className="admin-alert" role="alert"><CircleAlert size={16} />{error}</div>}
      <form onSubmit={login}>
        <label>Email<span className="admin-login-field"><Mail size={18} aria-hidden="true" /><input type="email" autoComplete="username" placeholder="Enter your email address" required value={email} onChange={(event) => setEmail(event.target.value)} /></span></label>
        <label>Password<span className="admin-login-field"><LockKeyhole size={18} aria-hidden="true" /><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button className="admin-password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
        <button className="admin-login-submit" disabled={busy}>{busy ? 'Signing in…' : <>Sign in <ArrowRight size={16} /></>}</button>
      </form>
      <Link to="/">Back to MarketHub</Link>
    </main>
  </div>

  if (isActivate) return <div className="admin-login-page admin-invitation-page">
    <Link to="/" className="admin-login-brand"><Tag size={56} strokeWidth={2.2} /><span><strong><em>Market</em>Hub</strong><small>Buy · Sell · Reuse · Save</small></span></Link>
    <main><span className="admin-eyebrow">SECOND-HAND ADMIN INVITATION</span><h1>Set your password</h1><p>Complete onboarding, then verify your email in the separate message we send.</p>
      {error && <div className="admin-alert" role="alert"><CircleAlert size={16} />{error}</div>}
      {notice ? <div className="admin-invite-success"><Mail size={18} /><span>{notice}</span><Link to="/admin/marketplace/login">Back to sign in</Link></div> : verificationToken ? <form onSubmit={activateAdminInvitation}>
        <label>Password<span className="admin-login-field"><LockKeyhole size={18} /><input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /></span></label>
        <label>Confirm password<span className="admin-login-field"><LockKeyhole size={18} /><input type="password" autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Enter your password again" /></span></label>
        <button className="admin-login-submit" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
      </form> : <div className="admin-alert" role="alert"><CircleAlert size={16} />This invitation link is missing its verification token.</div>}
      {!notice && <Link to="/admin/marketplace/login">Back to sign in</Link>}
    </main>
  </div>

  if (isVerify) return <div className="admin-login-page admin-invitation-page">
    <Link to="/" className="admin-login-brand"><Tag size={56} strokeWidth={2.2} /><span><strong><em>Market</em>Hub</strong><small>Buy · Sell · Reuse · Save</small></span></Link>
    <main><span className="admin-eyebrow">SECOND-HAND ADMIN EMAIL VERIFICATION</span><h1>Verify your email</h1><p>Confirm this address to activate your administrator access.</p>
      {error && <div className="admin-alert" role="alert"><CircleAlert size={16} />{error}</div>}
      {notice ? <div className="admin-invite-success"><ShieldCheck size={18} /><span>{notice}</span><Link to="/admin/marketplace/login">Go to sign in</Link></div> : verificationToken ? <button className="admin-login-submit" type="button" disabled={busy} onClick={() => void verifyAdminEmail()}>{busy ? 'Verifying…' : 'Verify email and activate'}</button> : <div className="admin-alert" role="alert"><CircleAlert size={16} />This verification link is missing its token.</div>}
      {!notice && <Link to="/admin/marketplace/login">Back to sign in</Link>}
    </main>
  </div>

  if (section === 'admins') return <div className="admin-app"><main className="admin-main"><section className="admin-workspace"><div className="admin-page-title"><div><span>PEOPLE &amp; ACCESS</span><h1>Second-hand administrators</h1></div></div><div className="admin-panel"><p>Administrator invitations, approvals, roles and permissions are managed in KitCulture Super Admin.</p><a className="admin-login-submit" href={`${kitzAdminOrigin}/super-admin/dashboard`}>Open Kitz Super Admin</a></div></section></main></div>

  if (section === 'sellers') return <div className="admin-app">
    <aside className="admin-sidebar"><Link to="/" className="admin-logo"><Tags /><span><b>MarketHub</b><small>Marketplace Admin</small></span></Link><nav aria-label="Marketplace administration"><Link to="/admin/marketplace/dashboard">Dashboard</Link><Link className="active" to="/admin/marketplace/dashboard?section=sellers">Seller accounts</Link><Link to="/admin/marketplace/dashboard?section=reports">Reports</Link></nav><div className="admin-sidebar-bottom"><button type="button" onClick={() => void logout()}><LogOut />Sign out</button></div></aside>
    <main className="admin-main"><header className="admin-topbar"><Link to="/admin/marketplace/dashboard">Marketplace dashboard</Link><span className="admin-user"><b>{admin?.role.replaceAll('_', ' ')}</b><small>{admin?.email}</small></span></header><section className="admin-workspace"><div className="admin-page-title"><div><span>SELLER SUPPORT</span><h1>Seller accounts</h1></div></div>{error && <div className="admin-alert" role="alert"><CircleAlert size={16} />{error}</div>}{notice && <p className="admin-success-message" role="status">{notice}</p>}<div className="admin-panel"><header><h2>Verified seller access</h2><span>{sellerAccounts.length} accounts</span></header><div className="admin-table-wrap"><table><thead><tr><th>Seller</th><th>Email</th><th>Location</th><th>Verification</th><th>Status</th><th>Action</th></tr></thead><tbody>{sellerAccounts.map((account) => <tr key={account.id}><td>{account.sellerName ?? 'Seller account'}</td><td>{account.email}</td><td>{account.town && account.county ? `${account.town}, ${account.county}` : '—'}</td><td>{account.emailVerifiedAt ? 'Verified' : 'Pending'}</td><td><span className={`status-pill status-${account.status}`}>{account.status}</span></td><td>{account.emailVerifiedAt && ['active', 'suspended'].includes(account.status) && <button className="admin-reconcile" type="button" disabled={busy} onClick={() => void updateSellerStatus(account)}>{account.status === 'active' ? 'Suspend' : 'Reactivate'}</button>}</td></tr>)}{!sellerAccounts.length && !loading && <tr><td colSpan={6}>No seller accounts found.</td></tr>}</tbody></table></div></div></section></main>
  </div>

  if (section === 'categories') return <div className="admin-app">
    <aside className="admin-sidebar"><Link to="/" className="admin-logo"><Tags /><span><b>MarketHub</b><small>Marketplace Admin</small></span></Link><nav aria-label="Marketplace administration"><Link to="/admin/marketplace/dashboard">Dashboard</Link><Link to="/admin/marketplace/dashboard?section=listings">Listings</Link><Link to="/admin/marketplace/dashboard?section=reports">Reports</Link><Link className="active" to="/admin/marketplace/dashboard?section=categories">Categories</Link></nav><div className="admin-sidebar-bottom"><button type="button" onClick={() => void logout()}><LogOut />Sign out</button></div></aside>
    <main className="admin-main"><header className="admin-topbar"><Link to="/admin/marketplace/dashboard">Marketplace dashboard</Link><span className="admin-user"><b>{admin?.role.replaceAll('_', ' ')}</b><small>{admin?.email}</small></span></header><section className="admin-workspace"><div className="admin-page-title"><div><span>MARKETPLACE OPERATIONS</span><h1>Categories</h1></div></div>{error && <div className="admin-alert" role="alert">{error}</div>}<div className="admin-panel"><header><h2>Marketplace categories</h2><span>Manage listing taxonomy</span></header><form className="admin-category-form" onSubmit={createCategory}><label>New category<input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Category name" /></label><button><Plus size={15} />Add category</button></form>{categoryError && <p className="admin-alert">{categoryError}</p>}<div className="admin-table-wrap"><table><thead><tr><th>Category</th><th>Slug</th><th>State</th><th>Action</th></tr></thead><tbody>{categories.map((category) => <tr key={category.id}><td>{category.name}</td><td>{category.slug}</td><td>{category.active ? 'Active' : 'Disabled'}</td><td><button className="admin-reconcile" onClick={() => void toggleCategory(category)}>{category.active ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table></div></div></section></main>
  </div>

  if (section === 'settings') return <div className="admin-app">
    <aside className="admin-sidebar"><Link to="/" className="admin-logo"><Tags /><span><b>MarketHub</b><small>Marketplace Admin</small></span></Link><nav aria-label="Marketplace administration"><Link to="/admin/marketplace/dashboard">Dashboard</Link><Link to="/admin/marketplace/dashboard?section=listings">Listings</Link><Link to="/admin/marketplace/dashboard?section=payments">Payments</Link><Link className="active" to="/admin/marketplace/dashboard?section=settings">Settings</Link></nav><div className="admin-sidebar-bottom"><button type="button" onClick={() => void logout()}><LogOut />Sign out</button></div></aside>
    <main className="admin-main"><header className="admin-topbar"><Link to="/admin/marketplace/dashboard">Marketplace dashboard</Link><span className="admin-user"><b>{admin?.role.replaceAll('_', ' ')}</b><small>{admin?.email}</small></span></header><section className="admin-workspace"><div className="admin-page-title"><div><span>MARKETPLACE OPERATIONS</span><h1>Settings</h1></div></div>{error && <div className="admin-alert" role="alert">{error}</div>}<div className="admin-panel admin-settings-panel"><header><h2>Marketplace fees and listing visibility</h2><span>Listing duration begins after verified publication</span></header><form onSubmit={saveFees}><label>Publication fee (basis points)<input type="number" min="1" max="10000" step="1" value={feeSettings.publicationFeeBasisPoints} onChange={(event) => setFeeSettings((current) => ({ ...current, publicationFeeBasisPoints: Number(event.target.value) }))} /></label><small>Basis points: 100 = 1%. Current rate: {feeSettings.publicationFeeBasisPoints / 100}%.</small><label>Contact unlock fee (basis points)<input type="number" min="1" max="10000" step="1" value={feeSettings.contactUnlockFeeBasisPoints} onChange={(event) => setFeeSettings((current) => ({ ...current, contactUnlockFeeBasisPoints: Number(event.target.value) }))} /></label><small>Current rate: {feeSettings.contactUnlockFeeBasisPoints / 100}%.</small><label>Listing visibility (days)<input type="number" min="1" max="365" step="1" value={feeSettings.listingExpiryDays} onChange={(event) => setFeeSettings((current) => ({ ...current, listingExpiryDays: Number(event.target.value) }))} /></label><small>Published listings become unavailable when this period ends.</small><button disabled={busy}>{busy ? 'Saving…' : 'Save fee settings'}</button></form></div><div className="admin-panel admin-settings-panel"><header><h2>Footer social links</h2><span>Only configured destinations are clickable</span></header><form onSubmit={saveFooterSocialSettings}><label>Facebook profile URL<input type="url" value={footerSocialSettings.facebookUrl} onChange={(event) => setFooterSocialSettings((current) => ({ ...current, facebookUrl: event.target.value }))} placeholder="https://facebook.com/your-page" /></label><label>X profile URL<input type="url" value={footerSocialSettings.xUrl} onChange={(event) => setFooterSocialSettings((current) => ({ ...current, xUrl: event.target.value }))} placeholder="https://x.com/your-profile" /></label><label>YouTube channel URL<input type="url" value={footerSocialSettings.youtubeUrl} onChange={(event) => setFooterSocialSettings((current) => ({ ...current, youtubeUrl: event.target.value }))} placeholder="https://youtube.com/@your-channel" /></label><label>WhatsApp mobile number (Kenya)<input type="tel" inputMode="tel" value={footerSocialSettings.whatsappPhone} onChange={(event) => setFooterSocialSettings((current) => ({ ...current, whatsappPhone: event.target.value }))} placeholder="0712 345 678" /></label><small>Enter a Kenyan mobile number; the footer will create the WhatsApp link using country code +254.</small><button disabled={busy}>{busy ? 'Saving…' : 'Save footer links'}</button></form></div></section></main>
  </div>

  const title = section === 'listings' ? 'Listings' : section === 'payments' ? 'Payments' : section === 'reports' ? 'Reports' : 'Dashboard'
  return <div className="admin-app">
    <aside className="admin-sidebar">
      <Link to="/" className="admin-logo"><Tags /><span><b>MarketHub</b><small>Marketplace Admin</small></span></Link>
      <nav aria-label="Marketplace administration">
        <Link className={section === 'dashboard' ? 'active' : ''} to="/admin/marketplace/dashboard"><LayoutDashboard />Dashboard</Link>
        {admin?.permissions.includes('listings:manage') && <Link className={section === 'listings' ? 'active' : ''} to="/admin/marketplace/dashboard?section=listings"><Box />Listings</Link>}
        {admin?.permissions.includes('finance:read') && <Link className={section === 'payments' ? 'active' : ''} to="/admin/marketplace/dashboard?section=payments"><CreditCard />Payments</Link>}
        {admin?.permissions.includes('support:manage') && <Link className={section === 'reports' ? 'active' : ''} to="/admin/marketplace/dashboard?section=reports"><CircleAlert />Reports</Link>}
          {admin?.permissions.includes('support:manage') && <Link className={section === 'sellers' ? 'active' : ''} to="/admin/marketplace/dashboard?section=sellers"><ShieldCheck />Seller accounts</Link>}
        {admin?.permissions.includes('categories:manage') && <Link className={section === 'categories' ? 'active' : ''} to="/admin/marketplace/dashboard?section=categories"><Tags />Categories</Link>}
        {admin?.permissions.includes('admins:manage') && <Link className={section === 'admins' ? 'active' : ''} to="/admin/marketplace/dashboard?section=admins"><ShieldCheck />Administrator access</Link>}
        {admin?.permissions.includes('settings:manage') && <Link className={section === 'settings' ? 'active' : ''} to="/admin/marketplace/dashboard?section=settings"><Settings />Settings</Link>}
      </nav>
      <div className="admin-sidebar-bottom"><span><ShieldCheck /><span><b>Marketplace only</b><small>Kitz access is separate</small></span></span><button type="button" onClick={() => void logout()}><LogOut />Sign out</button></div>
    </aside>
    <main className="admin-main">
      <header className="admin-topbar">{admin?.permissions.includes('listings:manage') && <form className="admin-listing-search" onSubmit={searchListings}><label><Search /><input value={listingSearchInput} onChange={(event) => setListingSearchInput(event.target.value)} placeholder="Search marketplace listings" aria-label="Search marketplace listings" /></label><button type="submit">Search</button></form>}<div><span className="admin-status"><Activity /> Marketplace</span><span className="admin-user"><b>{admin?.role.replaceAll('_', ' ') ?? 'Admin'}</b><small>{admin?.email}</small></span><ChevronDown size={15} /></div></header>
      <section className="admin-workspace"><div className="admin-page-title"><div><span>MARKETPLACE OPERATIONS</span><h1>{title}</h1></div><p><MapPin size={14} /> Kenya</p></div>
        {error && <div className="admin-alert" role="alert"><CircleAlert size={16} />{error}</div>}
        {loading ? <div className="admin-loading">Loading marketplace data…</div> : section === 'dashboard' ? <>
          {dashboard && <>
            <div className="admin-kpis"><article><span><Box /></span><div><small>Total listings</small><strong>{dashboard.listings.total.toLocaleString('en-KE')}</strong><em>{dashboard.listings.published.toLocaleString('en-KE')} published</em></div></article><article><span><CreditCard /></span><div><small>Successful payments</small><strong>{dashboard.payments.successful.toLocaleString('en-KE')}</strong><em>{dashboard.payments.pending} pending</em></div></article><article><span><CircleAlert /></span><div><small>Open reports</small><strong>{dashboard.reports.open.toLocaleString('en-KE')}</strong><em>Requires attention</em></div></article>{dashboard.revenueKes && <article><span><BadgeDollarSign /></span><div><small>Marketplace revenue</small><strong>{kes(dashboard.revenueKes.publication + dashboard.revenueKes.contactUnlock)}</strong><em>Verified fees only</em></div></article>}</div>
            <div className="admin-panel"><header><h2>Recent listings</h2><Link to="/admin/marketplace/dashboard?section=listings">View listings <ArrowRight size={14} /></Link></header><div className="admin-table-wrap"><table><thead><tr><th>Listing</th><th>Category</th><th>Location</th><th>Price</th><th>Status</th></tr></thead><tbody>{dashboard.recentListings.length ? dashboard.recentListings.map((item) => <tr key={item.reference}><td><b>{item.title}</b><small>{item.reference}</small></td><td>{item.category}</td><td>{item.county}</td><td>{kes(item.priceKes)}</td><td><span className={`status-pill status-${item.status}`}>{item.status.replaceAll('_', ' ')}</span></td></tr>) : <tr><td colSpan={5}>No listings have been submitted.</td></tr>}</tbody></table></div></div>
            <div className="admin-small-stats"><span><b>Pending payment</b>{dashboard.listings.pendingPayment}</span><span><b>Sold</b>{dashboard.listings.sold}</span><span><b>Suspended</b>{dashboard.listings.suspended}</span><span><b>Failed payments</b>{dashboard.payments.failed}</span><span><b>Ambiguous payments</b>{dashboard.payments.ambiguous}</span></div>
          </>}
        </> : section === 'listings' ? <div className="admin-panel"><header><h2>Marketplace listings</h2><span>{listings.length} loaded</span></header><div className="admin-table-wrap"><table><thead><tr><th>Listing</th><th>Category</th><th>Location</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead><tbody>{listings.length ? listings.map((item) => <tr key={item.reference}><td><b>{item.title}</b><small>{item.reference}</small></td><td>{item.category}</td><td>{item.town}, {item.county}</td><td>{kes(item.priceKes)}</td><td><span className={`status-pill status-${item.status}`}>{item.status.replaceAll('_', ' ')}</span></td><td className="admin-actions">{item.status === 'published' && <><button disabled={busy} onClick={() => void changeListingStatus(item.reference, 'suspended')}>Suspend</button><button disabled={busy} onClick={() => void changeListingStatus(item.reference, 'sold')}>Sold</button></>}{item.status === 'suspended' && <button disabled={busy} onClick={() => void changeListingStatus(item.reference, 'published')}>Restore</button>}</td></tr>) : <tr><td colSpan={6}>No listings found.</td></tr>}</tbody></table></div></div> : section === 'payments' ? <div className="admin-panel admin-payments-panel"><header><div><h2>Marketplace payments</h2><span>{paymentPagination?.total ?? payments.length} recorded payment entries</span></div><button className="admin-reconcile" type="button" disabled={!payments.length} onClick={exportPaymentsCsv}>Export CSV</button></header><div className="admin-payment-filters"><label>Status<select value={paymentStatusFilter} onChange={(event) => { setPaymentStatusFilter(event.target.value); setPaymentPage(1) }}><option value="">All statuses</option><option value="initiated">Initiated</option><option value="pending">Pending</option><option value="processing">Processing</option><option value="ambiguous">Needs review</option><option value="succeeded">Verified</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option><option value="expired">Expired</option><option value="reversed">Reversed</option><option value="refunded">Refunded</option></select></label><label>Purpose<select value={paymentPurposeFilter} onChange={(event) => { setPaymentPurposeFilter(event.target.value); setPaymentPage(1) }}><option value="">All purposes</option><option value="PRODUCT_PUBLICATION">Publication</option><option value="CONTACT_UNLOCK">Contact unlock</option></select></label></div><div className="admin-table-wrap"><table><thead><tr><th>Payment reference</th><th>Purpose</th><th>Listing</th><th>Amount</th><th>Status</th><th>M-Pesa receipt</th><th>Transaction time</th><th>Verified at</th><th>Created</th><th>Action</th></tr></thead><tbody>{payments.length ? payments.map((payment) => <tr key={payment.reference}><td>{payment.reference}</td><td>{payment.purpose.replaceAll('_', ' ')}</td><td>{payment.listingReference ?? '—'}</td><td>{kes(payment.amountKes)}</td><td><span className={`status-pill status-${payment.status}`}>{payment.status}</span></td><td>{payment.providerReceipt ?? '—'}</td><td>{payment.transactionAt ? new Date(payment.transactionAt).toLocaleString('en-KE') : '—'}</td><td>{payment.verifiedAt ? new Date(payment.verifiedAt).toLocaleString('en-KE') : '—'}</td><td>{new Date(payment.createdAt).toLocaleString('en-KE')}</td><td>{['pending', 'ambiguous'].includes(payment.status) && <button className="admin-reconcile" disabled={busy} onClick={() => void reconcilePayment(payment.reference)}>Reconcile</button>}</td></tr>) : <tr><td colSpan={10}>No marketplace payments match these filters.</td></tr>}</tbody></table></div><footer className="admin-payment-pagination"><span>{paymentPagination ? `Page ${paymentPagination.page} · ${paymentPagination.total} payments` : 'Payment records'}</span><div><button className="admin-reconcile" type="button" disabled={busy || paymentPage <= 1} onClick={() => setPaymentPage((page) => Math.max(1, page - 1))}>Previous</button><button className="admin-reconcile" type="button" disabled={busy || !paymentPagination?.hasMore} onClick={() => setPaymentPage((page) => page + 1)}>Next</button></div></footer></div> : section === 'reports' ? <div className="admin-panel"><header><h2>Listing reports</h2><span>{reports.length} open reports</span></header><div className="admin-table-wrap"><table><thead><tr><th>Listing</th><th>Reason</th><th>Details</th><th>Reporter</th><th>Received</th><th>Actions</th></tr></thead><tbody>{reports.length ? reports.map((report) => <tr key={report.id}><td><b>{report.title}</b><small>{report.reference}</small></td><td>{report.reason}</td><td>{report.details || '—'}</td><td>{report.reporterEmail || '—'}</td><td>{new Date(report.createdAt).toLocaleString('en-KE')}</td><td className="admin-actions"><button disabled={busy} onClick={() => void updateReport(report.id, 'reviewed')}>Review</button><button disabled={busy} onClick={() => void updateReport(report.id, 'resolved')}>Resolve</button><button disabled={busy} onClick={() => void updateReport(report.id, 'dismissed')}>Dismiss</button></td></tr>) : <tr><td colSpan={6}>No open listing reports.</td></tr>}</tbody></table></div></div> : <div className="admin-panel"><header><h2>Marketplace categories</h2><span>Manage listing taxonomy</span></header><form className="admin-category-form" onSubmit={createCategory}><label>New category<input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Category name" /></label><button><Plus size={15} />Add category</button></form>{categoryError && <p className="admin-alert">{categoryError}</p>}<div className="admin-table-wrap"><table><thead><tr><th>Category</th><th>Slug</th><th>State</th></tr></thead><tbody>{categories.map((category) => <tr key={category.id}><td>{category.name}</td><td>{category.slug}</td><td>{category.active ? 'Active' : 'Disabled'}</td></tr>)}</tbody></table></div></div>}
      </section>
    </main>
  </div>
}
