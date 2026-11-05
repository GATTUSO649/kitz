import { useEffect, useState, type FormEvent } from 'react'
import { Activity, ArrowRight, BadgeDollarSign, Box, ChevronDown, CircleAlert, CreditCard, LayoutDashboard, LogOut, MapPin, Plus, Search, Settings, ShieldCheck, Tags } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

type AdminUser = { id: string; email: string; role: string }
type Listing = { reference: string; title: string; status: string; priceKes: number; category: string; county: string; town: string }
type Category = { id: string; name: string; slug: string; active: boolean; sortOrder: number }
type Payment = { reference: string; purpose: string; amountKes: number; status: string; createdAt: string; listingReference: string | null }
type ListingReport = { id: string; reference: string; title: string; reason: string; details: string | null; reporterEmail: string | null; status: string; createdAt: string }
type FeeSettings = { publicationFeeBasisPoints: number; contactUnlockFeeBasisPoints: number; listingExpiryDays: number }
type FooterSocialSettings = { facebookUrl: string; xUrl: string; youtubeUrl: string; whatsappPhone: string }
type Dashboard = { listings: { total: number; published: number; pendingPayment: number; sold: number; expired: number; suspended: number }; payments: { successful: number; failed: number; pending: number; ambiguous: number }; reports: { open: number }; revenueKes?: { publication: number; contactUnlock: number }; recentListings: Listing[] }

const adminApi = '/api/v1/admin/marketplace'
const kes = (value: number) => `KSh ${new Intl.NumberFormat('en-KE').format(value)}`

export function MarketplaceAdminPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [reports, setReports] = useState<ListingReport[]>([])
  const [feeSettings, setFeeSettings] = useState<FeeSettings>({ publicationFeeBasisPoints: 1_000, contactUnlockFeeBasisPoints: 500, listingExpiryDays: 7 })
  const [footerSocialSettings, setFooterSocialSettings] = useState<FooterSocialSettings>({ facebookUrl: '', xUrl: '', youtubeUrl: '', whatsappPhone: '' })
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryName, setCategoryName] = useState('')
  const [categoryError, setCategoryError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [listingSearchInput, setListingSearchInput] = useState('')
  const [listingSearch, setListingSearch] = useState('')
  const isLogin = window.location.pathname.endsWith('/login')
  const section = searchParams.get('section') ?? 'dashboard'

  useEffect(() => {
    if (isLogin) return
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
      const endpoint = section === 'listings' ? `${adminApi}/listings?${listingQuery}`
        : section === 'payments' ? `${adminApi}/payments?page=1`
          : section === 'reports' ? `${adminApi}/reports?status=open`
            : section === 'settings' ? `${adminApi}/settings/fees`
          : section === 'categories' ? `${adminApi}/categories`
            : `${adminApi}/dashboard`
      const response = await fetch(endpoint, { signal: controller.signal })
      const result = await response.json() as { data?: Dashboard | Listing[] | Payment[] | ListingReport[] | Category[] | FeeSettings | FooterSocialSettings; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Marketplace data could not be loaded.')
      if (section === 'listings') setListings(result.data as Listing[])
      else if (section === 'payments') setPayments(result.data as Payment[])
      else if (section === 'reports') setReports(result.data as ListingReport[])
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
  }, [isLogin, listingSearch, navigate, section])

  function searchListings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setListingSearch(listingSearchInput.trim())
    if (section !== 'listings') navigate('/admin/marketplace/dashboard?section=listings')
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${adminApi}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Sign in failed.')
      setPassword('')
      navigate('/admin/marketplace/dashboard', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in failed.')
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

  if (isLogin) return <div className="admin-login-page">
    <Link to="/" className="admin-login-brand"><span><Tags size={24} /></span><strong>MarketHub</strong></Link>
    <main><span className="admin-eyebrow">MARKETPLACE ADMINISTRATION</span><h1>Welcome back</h1><p>Sign in to manage second-hand marketplace operations.</p>
      {error && <div className="admin-alert" role="alert"><CircleAlert size={16} />{error}</div>}
      <form onSubmit={login}><label>Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button disabled={busy}>{busy ? 'Signing in…' : <>Sign in <ArrowRight size={16} /></>}</button></form>
      <Link to="/">Back to MarketHub</Link>
    </main>
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
        <Link className={section === 'listings' ? 'active' : ''} to="/admin/marketplace/dashboard?section=listings"><Box />Listings</Link>
        <Link className={section === 'payments' ? 'active' : ''} to="/admin/marketplace/dashboard?section=payments"><CreditCard />Payments</Link>
        <Link className={section === 'reports' ? 'active' : ''} to="/admin/marketplace/dashboard?section=reports"><CircleAlert />Reports</Link>
        <Link className={section === 'categories' ? 'active' : ''} to="/admin/marketplace/dashboard?section=categories"><Tags />Categories</Link>
        {admin?.role === 'super_admin' && <Link className={section === 'settings' ? 'active' : ''} to="/admin/marketplace/dashboard?section=settings"><Settings />Settings</Link>}
      </nav>
      <div className="admin-sidebar-bottom"><span><ShieldCheck /><span><b>Marketplace only</b><small>Kitz access is separate</small></span></span><button type="button" onClick={() => void logout()}><LogOut />Sign out</button></div>
    </aside>
    <main className="admin-main">
      <header className="admin-topbar">{(admin?.role === 'super_admin' || admin?.role === 'product_admin') && <form className="admin-listing-search" onSubmit={searchListings}><label><Search /><input value={listingSearchInput} onChange={(event) => setListingSearchInput(event.target.value)} placeholder="Search marketplace listings" aria-label="Search marketplace listings" /></label><button type="submit">Search</button></form>}<div><span className="admin-status"><Activity /> Marketplace</span><span className="admin-user"><b>{admin?.role.replaceAll('_', ' ') ?? 'Admin'}</b><small>{admin?.email}</small></span><ChevronDown size={15} /></div></header>
      <section className="admin-workspace"><div className="admin-page-title"><div><span>MARKETPLACE OPERATIONS</span><h1>{title}</h1></div><p><MapPin size={14} /> Kenya</p></div>
        {error && <div className="admin-alert" role="alert"><CircleAlert size={16} />{error}</div>}
        {loading ? <div className="admin-loading">Loading marketplace data…</div> : section === 'dashboard' ? <>
          {dashboard && <>
            <div className="admin-kpis"><article><span><Box /></span><div><small>Total listings</small><strong>{dashboard.listings.total.toLocaleString('en-KE')}</strong><em>{dashboard.listings.published.toLocaleString('en-KE')} published</em></div></article><article><span><CreditCard /></span><div><small>Successful payments</small><strong>{dashboard.payments.successful.toLocaleString('en-KE')}</strong><em>{dashboard.payments.pending} pending</em></div></article><article><span><CircleAlert /></span><div><small>Open reports</small><strong>{dashboard.reports.open.toLocaleString('en-KE')}</strong><em>Requires attention</em></div></article>{dashboard.revenueKes && <article><span><BadgeDollarSign /></span><div><small>Marketplace revenue</small><strong>{kes(dashboard.revenueKes.publication + dashboard.revenueKes.contactUnlock)}</strong><em>Verified fees only</em></div></article>}</div>
            <div className="admin-panel"><header><h2>Recent listings</h2><Link to="/admin/marketplace/dashboard?section=listings">View listings <ArrowRight size={14} /></Link></header><div className="admin-table-wrap"><table><thead><tr><th>Listing</th><th>Category</th><th>Location</th><th>Price</th><th>Status</th></tr></thead><tbody>{dashboard.recentListings.length ? dashboard.recentListings.map((item) => <tr key={item.reference}><td><b>{item.title}</b><small>{item.reference}</small></td><td>{item.category}</td><td>{item.county}</td><td>{kes(item.priceKes)}</td><td><span className={`status-pill status-${item.status}`}>{item.status.replaceAll('_', ' ')}</span></td></tr>) : <tr><td colSpan={5}>No listings have been submitted.</td></tr>}</tbody></table></div></div>
            <div className="admin-small-stats"><span><b>Pending payment</b>{dashboard.listings.pendingPayment}</span><span><b>Sold</b>{dashboard.listings.sold}</span><span><b>Suspended</b>{dashboard.listings.suspended}</span><span><b>Failed payments</b>{dashboard.payments.failed}</span><span><b>Ambiguous payments</b>{dashboard.payments.ambiguous}</span></div>
          </>}
        </> : section === 'listings' ? <div className="admin-panel"><header><h2>Marketplace listings</h2><span>{listings.length} loaded</span></header><div className="admin-table-wrap"><table><thead><tr><th>Listing</th><th>Category</th><th>Location</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead><tbody>{listings.length ? listings.map((item) => <tr key={item.reference}><td><b>{item.title}</b><small>{item.reference}</small></td><td>{item.category}</td><td>{item.town}, {item.county}</td><td>{kes(item.priceKes)}</td><td><span className={`status-pill status-${item.status}`}>{item.status.replaceAll('_', ' ')}</span></td><td className="admin-actions">{item.status === 'published' && <><button disabled={busy} onClick={() => void changeListingStatus(item.reference, 'suspended')}>Suspend</button><button disabled={busy} onClick={() => void changeListingStatus(item.reference, 'sold')}>Sold</button></>}{item.status === 'suspended' && <button disabled={busy} onClick={() => void changeListingStatus(item.reference, 'published')}>Restore</button>}</td></tr>) : <tr><td colSpan={6}>No listings found.</td></tr>}</tbody></table></div></div> : section === 'payments' ? <div className="admin-panel"><header><h2>Marketplace payments</h2><span>Publication and contact-unlock fees only</span></header><div className="admin-table-wrap"><table><thead><tr><th>Payment reference</th><th>Purpose</th><th>Listing</th><th>Amount</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{payments.length ? payments.map((payment) => <tr key={payment.reference}><td>{payment.reference}</td><td>{payment.purpose.replaceAll('_', ' ')}</td><td>{payment.listingReference ?? '—'}</td><td>{kes(payment.amountKes)}</td><td><span className={`status-pill status-${payment.status}`}>{payment.status}</span></td><td>{new Date(payment.createdAt).toLocaleString('en-KE')}</td><td>{['pending', 'ambiguous'].includes(payment.status) && <button className="admin-reconcile" disabled={busy} onClick={() => void reconcilePayment(payment.reference)}>Reconcile</button>}</td></tr>) : <tr><td colSpan={7}>No marketplace payments recorded.</td></tr>}</tbody></table></div></div> : section === 'reports' ? <div className="admin-panel"><header><h2>Listing reports</h2><span>{reports.length} open reports</span></header><div className="admin-table-wrap"><table><thead><tr><th>Listing</th><th>Reason</th><th>Details</th><th>Reporter</th><th>Received</th><th>Actions</th></tr></thead><tbody>{reports.length ? reports.map((report) => <tr key={report.id}><td><b>{report.title}</b><small>{report.reference}</small></td><td>{report.reason}</td><td>{report.details || '—'}</td><td>{report.reporterEmail || '—'}</td><td>{new Date(report.createdAt).toLocaleString('en-KE')}</td><td className="admin-actions"><button disabled={busy} onClick={() => void updateReport(report.id, 'reviewed')}>Review</button><button disabled={busy} onClick={() => void updateReport(report.id, 'resolved')}>Resolve</button><button disabled={busy} onClick={() => void updateReport(report.id, 'dismissed')}>Dismiss</button></td></tr>) : <tr><td colSpan={6}>No open listing reports.</td></tr>}</tbody></table></div></div> : <div className="admin-panel"><header><h2>Marketplace categories</h2><span>Manage listing taxonomy</span></header><form className="admin-category-form" onSubmit={createCategory}><label>New category<input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Category name" /></label><button><Plus size={15} />Add category</button></form>{categoryError && <p className="admin-alert">{categoryError}</p>}<div className="admin-table-wrap"><table><thead><tr><th>Category</th><th>Slug</th><th>State</th></tr></thead><tbody>{categories.map((category) => <tr key={category.id}><td>{category.name}</td><td>{category.slug}</td><td>{category.active ? 'Active' : 'Disabled'}</td></tr>)}</tbody></table></div></div>}
      </section>
    </main>
  </div>
}
