import { useEffect, useEffectEvent, useState, type FormEvent } from 'react'
import { Activity, ArrowLeft, ArrowRight, BadgeCheck, BarChart3, Bell, Box, CalendarDays, Check, ChevronDown, CircleAlert, CircleHelp, Clock3, Eye, EyeOff, LayoutDashboard, Leaf, ListChecks, LogOut, MapPin, Megaphone, Menu, MessageSquareText, Pencil, Plus, Search, Settings, ShieldCheck, ShoppingBag, Store, Tag, Trash2, UserRound, WalletCards, X } from 'lucide-react'
import { marketplaceFetch } from './api'
import { SiteImage } from './SiteImages'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

type County = { code: string; name: string }
type SellerProfile = { id: string; email: string; sellerId: string; name: string; phone: string; whatsapp: string | null; countyCode: string; county: string; subcounty: string; town: string; area: string | null }
type SellerImage = { id: string; imageUrl: string; isPrimary: boolean; sortOrder: number }
type SellerProduct = { id: string; reference: string; slug: string; title: string; description: string; condition: string; priceKes: number; negotiable: boolean; status: string; expiresAt: string | null; publicAvailable: boolean; categoryId: string; category: string; categoryActive: boolean; subcategoryId: string | null; createdAt: string; publishedAt: string | null; images: SellerImage[] }
type OtherProduct = { slug: string; title: string; priceKes: number; category: string; county: string; town: string; imageUrl: string | null; condition: string }
type Category = { id: string; name: string; subcategories: { id: string; name: string }[] }
type ProductDraft = Pick<SellerProduct, 'title' | 'description' | 'categoryId' | 'subcategoryId' | 'condition' | 'priceKes' | 'negotiable'>
type SellerSection = 'dashboard' | 'listings' | 'orders' | 'messages' | 'analytics' | 'promotions' | 'payments' | 'reviews' | 'profile' | 'settings' | 'help'
type SellerAnalytics = { listingViews: number; viewsLast30Days: number; viewsPrevious30Days: number; dailyViews: { day: string; views: number }[]; viewsByListing: { reference: string; views: number }[]; interestedViewers: { name: string; phone: string; reference: string; title: string; paidAt: string | null }[] }
type SellerActivity = { action: string; reference: string | null; title: string | null; createdAt: string }
type ViewsChartPoint = { label: string; views: number; previous: number }

const sellerApi = '/api/v1/marketplace/seller'
const sellerSections: SellerSection[] = ['dashboard', 'listings', 'orders', 'messages', 'analytics', 'promotions', 'payments', 'reviews', 'profile', 'settings', 'help']
const sellerNavigation: { id: SellerSection | 'add'; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'listings', label: 'My Listings', icon: ListChecks },
  { id: 'add', label: 'Add Item', icon: Plus },
  { id: 'orders', label: 'Orders & Sales', icon: ShoppingBag },
  { id: 'messages', label: 'Messages', icon: MessageSquareText },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'promotions', label: 'Promotions', icon: Megaphone },
  { id: 'payments', label: 'Payments & Earnings', icon: WalletCards },
  { id: 'reviews', label: 'Reviews & Ratings', icon: BadgeCheck },
  { id: 'profile', label: 'Profile & Settings', icon: UserRound },
  { id: 'settings', label: 'Account Security', icon: Settings },
  { id: 'help', label: 'Help & Support', icon: CircleHelp },
]
const formatKes = (value: number) => `KSh ${new Intl.NumberFormat('en-KE').format(value)}`

function SellerProductImage({ src, alt = '', size = 24 }: { src?: string; alt?: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <Box size={size} aria-hidden="true" />
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
}

type SellerPortalSidebarProps = {
  activeSection: SellerSection | 'add'
  menuOpen: boolean
  onClose: () => void
  onSelectSection?: (section: SellerSection) => void
}

export function SellerPortalSidebar({ activeSection, menuOpen, onClose, onSelectSection }: SellerPortalSidebarProps) {
  const renderItem = (item: typeof sellerNavigation[number]) => {
    const className = `seller-sidebar-link${activeSection === item.id ? ' active' : ''}`
    const Icon = item.icon
    if (item.id === 'add') return <Link className={className} to="/marketplace/sell" key={item.id} onClick={onClose}><Icon /><span>{item.label}</span></Link>
    if (onSelectSection) return <button className={className} type="button" key={item.id} onClick={() => { onSelectSection(item.id as SellerSection); onClose() }}><Icon /><span>{item.label}</span></button>
    return <Link className={className} to={`/marketplace/seller?section=${item.id}`} key={item.id} onClick={onClose}><Icon /><span>{item.label}</span></Link>
  }
  return <aside className={`seller-dashboard-sidebar${menuOpen ? ' is-open' : ''}`}>
    <Link to="/marketplace" className="seller-sidebar-brand" aria-label="MATRIX marketplace" onClick={onClose}><SiteImage slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" /></Link>
    <nav aria-label="Seller portal">{sellerNavigation.map(renderItem)}</nav>
    <div className="seller-sidebar-bottom"><div className="seller-green-promo"><Leaf /><strong>GROW YOUR BUSINESS</strong><span>Reach more local buyers with MarketHub.</span>{onSelectSection ? <button type="button" onClick={() => { onSelectSection('help'); onClose() }}>Learn More <ArrowRight size={13} /></button> : <Link to="/marketplace/seller?section=help" onClick={onClose}>Learn More <ArrowRight size={13} /></Link>}</div></div>
  </aside>
}

function isSellerSection(value: string | null): value is SellerSection {
  return value !== null && sellerSections.includes(value as SellerSection)
}

async function getError(_response: Response, fallback: string) {
  return fallback
}

function SellerAuthBrand() {
  return <Link to="/marketplace" className="seller-auth-brand"><Tag size={52} strokeWidth={2.2} /><span><strong><em>Market</em>Hub</strong><small>Buy · Sell · Reuse · Save</small></span></Link>
}

function SellerHeader({ profile }: { profile?: SellerProfile | null }) {
  return <header className="seller-portal-header"><Link className="market-brand" to="/marketplace" aria-label="MATRIX marketplace"><SiteImage slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" /></Link><nav><Link to="/marketplace">Marketplace</Link>{profile ? <Link to="/marketplace/seller">My account</Link> : <Link to="/marketplace/seller/login">Seller sign in</Link>}</nav></header>
}

export function SellerSignupPage() {
  const [counties, setCounties] = useState<County[]>([])
  const [loadingCounties, setLoadingCounties] = useState(true)
  const [error, setError] = useState('')
  const [pendingEmail, setPendingEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [values, setValues] = useState({ name: '', email: '', phone: '', whatsapp: '', countyCode: '', password: '', confirmPassword: '' })

  useEffect(() => {
    const controller = new AbortController()
    marketplaceFetch('/api/v1/marketplace/locations/counties', { signal: controller.signal }).then(async (response) => {
      const result = await response.json().catch(() => ({})) as { data?: County[]; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'County information is unavailable.')
      setCounties(result.data)
      setValues((current) => ({ ...current, countyCode: result.data?.[0]?.code ?? '' }))
    }).catch(() => { if (!controller.signal.aborted) setError('County information is unavailable.') })
      .finally(() => { if (!controller.signal.aborted) setLoadingCounties(false) })
    return () => controller.abort()
  }, [])

  const update = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }))
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await marketplaceFetch(`${sellerApi}/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, acceptedTerms }) })
      if (response.status === 409) {
        setError('An account already uses this email. Sign in or request a new verification email.')
        return
      }
      if (response.status === 400) {
        setError('Please check your account details, location, and password and try again.')
        return
      }
      if (!response.ok) throw new Error(await getError(response, 'Seller registration failed.'))
      setPendingEmail(values.email)
    } catch {
      setError('Seller registration failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="seller-auth-page"><SellerAuthBrand /><main className="seller-auth-main">
    <Link to="/marketplace" className="back-link"><ArrowLeft size={15} /> Marketplace</Link>
    {pendingEmail ? <section className="seller-auth-card seller-verified-state"><span className="seller-auth-icon"><BadgeCheck /></span><span className="seller-eyebrow">ONE MORE STEP</span><h1>Check your email</h1><p>We sent a verification link to <strong>{pendingEmail}</strong>. Verify your address before signing in.</p><Link className="seller-primary-button" to="/marketplace/seller/login">Continue to sign in <ArrowRight size={16} /></Link></section> : <section className="seller-auth-card">
      <span className="seller-eyebrow">SELLER ACCOUNT</span><h1>Create your account</h1><p>Verify your email to manage your listings in one place.</p>
      {error && <div className="seller-error" role="alert"><CircleAlert size={16} />{error}</div>}
      <form className="seller-account-form" onSubmit={submit}>
        <label>Full name<input required minLength={2} maxLength={120} autoComplete="name" value={values.name} onChange={(event) => update('name', event.target.value)} /></label>
        <label>Email address<input required type="email" maxLength={254} autoComplete="email" value={values.email} onChange={(event) => update('email', event.target.value)} /></label>
        <div className="seller-form-pair"><label>Phone<input required inputMode="tel" autoComplete="tel" value={values.phone} onChange={(event) => update('phone', event.target.value)} placeholder="0712 345 678" /></label><label>WhatsApp (optional)<input inputMode="tel" value={values.whatsapp} onChange={(event) => update('whatsapp', event.target.value)} /></label></div>
        <label>County<select required disabled={loadingCounties} value={values.countyCode} onChange={(event) => update('countyCode', event.target.value)}><option value="">Select county</option>{counties.map((county) => <option key={county.code} value={county.code}>{county.name}</option>)}</select></label>
        <label>Password<span className="seller-auth-password"><input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} value={values.password} onChange={(event) => update('password', event.target.value)} /><button type="button" className="seller-auth-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
        <label>Confirm password<span className="seller-auth-password"><input required type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} value={values.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)} /><button type="button" className="seller-auth-password-toggle" aria-label={showConfirmPassword ? 'Hide password' : 'Show password'} onClick={() => setShowConfirmPassword((shown) => !shown)}>{showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
        <label className="seller-terms-acceptance"><input type="checkbox" required checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>I agree to the <Link to="/terms" target="_blank" rel="noreferrer">Terms &amp; Conditions</Link> and acknowledge the <Link to="/privacy" target="_blank" rel="noreferrer">Privacy Statement</Link>.</span></label>
        <button className="seller-primary-button" disabled={busy || loadingCounties || !counties.length || !acceptedTerms}>{busy ? 'Creating account…' : <>Create seller account <ArrowRight size={16} /></>}</button>
      </form>
      <p className="seller-auth-switch">Already registered? <Link to="/marketplace/seller/login">Sign in</Link></p>
    </section>}
  </main></div>
}

export function SellerLoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await marketplaceFetch(`${sellerApi}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      if (!response.ok) throw new Error(await getError(response, 'Sign in failed.'))
      navigate('/marketplace/seller', { replace: true })
    } catch {
      setError('Sign in failed. Please check your details and try again.')
    } finally {
      setBusy(false)
    }
  }
  return <div className="seller-auth-page"><SellerAuthBrand /><main className="seller-auth-main"><Link to="/marketplace" className="back-link"><ArrowLeft size={15} /> Marketplace</Link><section className="seller-auth-card">
    <span className="seller-eyebrow">SELLER ACCOUNT</span><h1>Welcome back</h1><p>Sign in to manage your products and browse the marketplace.</p>
    {error && <div className="seller-error" role="alert"><CircleAlert size={16} />{error}</div>}
    <form className="seller-account-form" onSubmit={submit}><label>Email address<input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<span className="seller-auth-password"><input required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="seller-auth-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label><button className="seller-primary-button" disabled={busy}>{busy ? 'Signing in…' : <>Sign in <ArrowRight size={16} /></>}</button></form>
    <p className="seller-auth-reset-link"><Link to="/marketplace/seller/forgot-password">Forgot password?</Link></p>
    <p className="seller-auth-switch">New to selling? <Link to="/marketplace/seller/signup">Create seller account</Link></p>
  </section></main></div>
}

export function SellerForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [requested, setRequested] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await marketplaceFetch(`${sellerApi}/password/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      if (!response.ok) throw new Error(await getError(response, 'Password recovery is unavailable.'))
      setRequested(true)
    } catch {
      setError('Password recovery is unavailable. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="seller-auth-page"><SellerAuthBrand /><main className="seller-auth-main"><Link to="/marketplace/seller/login" className="back-link"><ArrowLeft size={15} /> Sign in</Link><section className="seller-auth-card">
    <span className="seller-eyebrow">SELLER ACCOUNT</span><h1>Reset your password</h1>
    {requested ? <p role="status">If an active seller account uses that email, password reset instructions have been sent.</p> : <><p>Enter the email address on your seller account.</p>{error && <div className="seller-error" role="alert"><CircleAlert size={16} />{error}</div>}<form className="seller-account-form" onSubmit={submit}><label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><button className="seller-primary-button" disabled={busy}>{busy ? 'Sending…' : <>Send reset link <ArrowRight size={16} /></>}</button></form></>}
  </section></main></div>
}

export function SellerResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [reset, setReset] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await marketplaceFetch(`${sellerApi}/password/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password, confirmPassword }) })
      if (!response.ok) throw new Error(await getError(response, 'The reset link could not be used.'))
      setPassword('')
      setConfirmPassword('')
      setReset(true)
    } catch {
      setError('The reset link could not be used. Please request a new one.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="seller-auth-page"><SellerAuthBrand /><main className="seller-auth-main"><Link to="/marketplace/seller/login" className="back-link"><ArrowLeft size={15} /> Sign in</Link><section className="seller-auth-card">
    <span className="seller-eyebrow">SELLER ACCOUNT</span><h1>Choose a new password</h1>
    {reset ? <><p role="status">Your password has been reset. Sign in with your new password.</p><Link className="seller-primary-button" to="/marketplace/seller/login">Continue to sign in <ArrowRight size={16} /></Link></> : !token ? <p className="seller-error" role="alert">This password reset link is missing its token.</p> : <><p>Use a new password with at least 12 characters.</p>{error && <div className="seller-error" role="alert"><CircleAlert size={16} />{error}</div>}<form className="seller-account-form" onSubmit={submit}><label>New password<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Confirm new password<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label><button className="seller-primary-button" disabled={busy}>{busy ? 'Updating…' : <>Reset password <ArrowRight size={16} /></>}</button></form></>}
  </section></main></div>
}

export function SellerVerifyPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [message, setMessage] = useState('Verifying your email…')
  const [error, setError] = useState('')
  const token = searchParams.get('token') ?? ''
  const displayError = error || (!token ? 'This verification link is missing its token.' : '')
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    marketplaceFetch(`${sellerApi}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(await getError(response, 'Email verification failed.'))
      setMessage('Your email is verified. You can now sign in and manage your listings.')
    }).catch(() => { if (!controller.signal.aborted) { setError('Email verification failed. Please try again.'); setMessage('') } })
    return () => controller.abort()
  }, [token])
  return <div className="seller-auth-page"><SellerAuthBrand /><main className="seller-auth-main"><section className="seller-auth-card seller-verified-state"><span className={`seller-auth-icon${displayError ? ' is-error' : ''}`}>{displayError ? <CircleAlert /> : <BadgeCheck />}</span><span className="seller-eyebrow">SELLER ACCOUNT</span><h1>{displayError ? 'Verification failed' : message === 'Verifying your email…' ? 'Verifying your email' : 'Email verified'}</h1>{displayError ? <p className="seller-error" role="alert">{displayError}</p> : <p>{message}</p>}{message !== 'Verifying your email…' && !displayError && <button className="seller-primary-button" type="button" onClick={() => navigate('/marketplace/seller/login', { replace: true })}>Continue to sign in <ArrowRight size={16} /></button>}{displayError && <Link className="seller-primary-button" to="/marketplace/seller/signup">Return to registration</Link>}</section></main></div>
}

type ViewsPeriod = 'daily' | 'weekly' | 'monthly'

function buildViewsChartData(dailyViews: SellerAnalytics['dailyViews'], period: ViewsPeriod) {
  const viewsByDay = new Map(dailyViews.map((item) => [item.day, item.views]))
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const sumDays = (start: Date, count: number) => {
    let total = 0
    for (let offset = 0; offset < count; offset += 1) {
      const date = new Date(start)
      date.setUTCDate(date.getUTCDate() + offset)
      total += viewsByDay.get(date.toISOString().slice(0, 10)) ?? 0
    }
    return total
  }

  if (period === 'daily') return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() - (29 - index))
    const previousDate = new Date(date)
    previousDate.setUTCDate(previousDate.getUTCDate() - 30)
    const key = date.toISOString().slice(0, 10)
    return { label: date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'UTC' }), views: viewsByDay.get(key) ?? 0, previous: viewsByDay.get(previousDate.toISOString().slice(0, 10)) ?? 0 }
  })

  if (period === 'weekly') {
    today.setUTCDate(today.getUTCDate() - (today.getUTCDay() + 6) % 7)
    return Array.from({ length: 12 }, (_, index) => {
      const start = new Date(today)
      start.setUTCDate(start.getUTCDate() - (11 - index) * 7)
      const previousStart = new Date(start)
      previousStart.setUTCDate(previousStart.getUTCDate() - 84)
      return { label: start.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'UTC' }), views: sumDays(start, 7), previous: sumDays(previousStart, 7) }
    })
  }

  const currentMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  return Array.from({ length: 6 }, (_, index) => {
    const start = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - (5 - index), 1))
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
    const previousStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 6, 1))
    const previousEnd = new Date(Date.UTC(previousStart.getUTCFullYear(), previousStart.getUTCMonth() + 1, 1))
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000)
    const previousDays = Math.round((previousEnd.getTime() - previousStart.getTime()) / 86_400_000)
    return { label: start.toLocaleDateString('en-KE', { month: 'short', year: '2-digit', timeZone: 'UTC' }), views: sumDays(start, days), previous: sumDays(previousStart, previousDays) }
  })
}

function SellerViewsChart({ data }: { data: ViewsChartPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const width = 720
  const height = 220
  const left = 38
  const right = 12
  const top = 14
  const bottom = 28
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const maximum = Math.max(4, ...data.flatMap((item) => [item.views, item.previous]))
  const x = (index: number) => left + index / Math.max(1, data.length - 1) * chartWidth
  const y = (value: number) => top + chartHeight - value / maximum * chartHeight
  const path = (key: 'views' | 'previous') => data.map((item, index) => `${x(index)},${y(item[key])}`).join(' ')
  const interval = data.length > 18 ? 5 : data.length > 10 ? 3 : 1
  const hovered = hoverIndex === null ? null : data[hoverIndex]

  return <div className="seller-chart-canvas">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Daily listing views compared with the previous period">
      {Array.from({ length: 5 }, (_, index) => {
        const value = Math.ceil(maximum / 4 * (4 - index))
        const lineY = top + chartHeight / 4 * index
        return <g key={index}><line x1={left} x2={width - right} y1={lineY} y2={lineY} stroke="#e8edf4" /><text x={left - 7} y={lineY + 3} textAnchor="end" fill="#64748b" fontSize="9">{value}</text></g>
      })}
      <polyline points={path('previous')} fill="none" stroke="#bdcfee" strokeWidth="2" strokeDasharray="5 5" />
      <polyline points={path('views')} fill="none" stroke="#2563eb" strokeWidth="2.5" />
      {data.map((item, index) => <g key={`${item.label}-${index}`}>
        <circle cx={x(index)} cy={y(item.views)} r={hoverIndex === index ? 4 : 2.5} fill="#2563eb" tabIndex={0} aria-label={`${item.label}: ${item.views} views; ${item.previous} previous period`} onMouseEnter={() => setHoverIndex(index)} onMouseLeave={() => setHoverIndex(null)} onFocus={() => setHoverIndex(index)} onBlur={() => setHoverIndex(null)} />
        {index % interval === 0 && <text x={x(index)} y={height - 7} textAnchor="middle" fill="#64748b" fontSize="9">{item.label}</text>}
      </g>)}
    </svg>
    {hovered && hoverIndex !== null && <div className="seller-chart-tooltip" style={{ left: `${x(hoverIndex) / width * 100}%`, top: `${Math.max(4, y(hovered.views) / height * 100 - 13)}%` }}><strong>{hovered.label}</strong><span>This period: {hovered.views.toLocaleString('en-KE')}</span><span>Previous: {hovered.previous.toLocaleString('en-KE')}</span></div>}
  </div>
}

function activityLabel(action: string) {
  const labels: Record<string, string> = {
    'listing.created': 'Listing submitted',
    'listing.published': 'Listing published',
    'seller.listing.updated': 'Listing updated',
    'seller.listing.sold': 'Marked as sold',
    'seller.listing.removed': 'Listing removed',
  }
  return labels[action] ?? 'Listing activity'
}

export function SellerPortalPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [profile, setProfile] = useState<SellerProfile | null>(null)
  const [products, setProducts] = useState<SellerProduct[]>([])
  const [analytics, setAnalytics] = useState<SellerAnalytics | null>(null)
  const [activity, setActivity] = useState<SellerActivity[]>([])
  const [otherProducts, setOtherProducts] = useState<OtherProduct[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [counties, setCounties] = useState<County[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [section, setSection] = useState<SellerSection>(() => {
    const requestedSection = searchParams.get('section')
    return isSellerSection(requestedSection) ? requestedSection : 'dashboard'
  })
  const [tab, setTab] = useState<'mine' | 'marketplace'>('mine')
  const [viewsPeriod, setViewsPeriod] = useState<ViewsPeriod>('daily')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<SellerProduct | null>(null)
  const [draft, setDraft] = useState<ProductDraft | null>(null)
  const [profileDraft, setProfileDraft] = useState({ name: '', phone: '', whatsapp: '', countyCode: '', subcounty: '', town: '', area: '' })
  const [passwordDraft, setPasswordDraft] = useState({ currentPassword: '', password: '', confirmPassword: '' })
  const [notice, setNotice] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const setProfileFromSession = useEffectEvent((value: SellerProfile) => {
    setProfile(value)
    setProfileDraft({ name: value.name, phone: value.phone, whatsapp: value.whatsapp ?? '', countyCode: value.countyCode, subcounty: value.subcounty, town: value.town, area: value.area ?? '' })
  })

  async function loadProducts(signal?: AbortSignal) {
    const [mineResponse, otherResponse, categoryResponse, countyResponse] = await Promise.all([
      marketplaceFetch(`${sellerApi}/products`, { signal }),
      marketplaceFetch('/api/v1/marketplace/products?limit=24', { signal }),
      marketplaceFetch('/api/v1/marketplace/categories', { signal }),
      marketplaceFetch('/api/v1/marketplace/locations/counties', { signal }),
    ])
    if (!mineResponse.ok) throw new Error(await getError(mineResponse, 'Your products could not be loaded.'))
    if (!otherResponse.ok) throw new Error(await getError(otherResponse, 'Marketplace products could not be loaded.'))
    if (!categoryResponse.ok) throw new Error(await getError(categoryResponse, 'Product categories could not be loaded.'))
    if (!countyResponse.ok) throw new Error(await getError(countyResponse, 'Seller locations could not be loaded.'))
    const mine = await mineResponse.json() as { data: SellerProduct[]; analytics: SellerAnalytics; recentActivity: SellerActivity[] }
    const others = await otherResponse.json() as { data: OtherProduct[] }
    const categoryData = await categoryResponse.json() as { data: Category[] }
    const countyData = await countyResponse.json() as { data: County[] }
    setProducts(mine.data)
    setAnalytics(mine.analytics)
    setActivity(mine.recentActivity)
    setOtherProducts(others.data)
    setCategories(categoryData.data)
    setCounties(countyData.data)
  }

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      marketplaceFetch(`${sellerApi}/session`, { signal: controller.signal }).then(async (response) => {
        if (response.status === 401) { navigate('/marketplace/seller/login', { replace: true }); return }
        if (!response.ok) throw new Error(await getError(response, 'Seller account could not be loaded.'))
        const result = await response.json() as { data: SellerProfile }
        setProfileFromSession(result.data)
      }),
      loadProducts(controller.signal),
    ]).catch(() => { if (!controller.signal.aborted) setError('Seller products could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [navigate])

  async function refresh() {
    setError('')
    try { await loadProducts() } catch { setError('Products could not be refreshed.') }
  }

  async function logout() {
    setAccountMenuOpen(false)
    await marketplaceFetch(`${sellerApi}/logout`, { method: 'POST' })
    navigate('/marketplace/seller/login', { replace: true })
  }

  async function markSold(product: SellerProduct) {
    if (!window.confirm(`Mark “${product.title}” as sold?`)) return
    setBusy(true)
    setError('')
    try {
      const response = await marketplaceFetch(`${sellerApi}/products/${product.reference}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'sold' }) })
      if (!response.ok) throw new Error(await getError(response, 'The listing could not be marked as sold.'))
      await refresh()
    } catch { setError('The listing could not be marked as sold.') }
    finally { setBusy(false) }
  }

  async function retryPublicationPayment(product: SellerProduct) {
    const phone = window.prompt('M-Pesa phone number for the payment prompt:', profile?.phone ?? '')
    if (!phone?.trim()) return
    setBusy(true)
    setError('')
    setNotice('Starting or checking the publication payment…')
    try {
      const response = await marketplaceFetch('/api/v1/marketplace/payments/publication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: product.reference, phone }),
      })
      const result = await response.json() as { data?: { paymentReference: string; status: string; amountKes: number; existing?: boolean }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'The publication payment could not be started.')
      setNotice(result.data.existing ? 'An existing payment is being checked. No duplicate M-Pesa prompt was sent.' : 'Approve the M-Pesa prompt on your phone.')
      for (let attempt = 0; attempt < 36; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500))
        const statusResponse = await marketplaceFetch(`/api/v1/marketplace/payments/${result.data.paymentReference}/status`)
        const statusResult = await statusResponse.json() as { data?: { status: string; listingStatus: string | null }; error?: { message?: string } }
        if (!statusResponse.ok || !statusResult.data) throw new Error(statusResult.error?.message ?? 'Payment status could not be checked.')
        if (statusResult.data.status === 'succeeded' && statusResult.data.listingStatus === 'published') {
          setNotice('Payment verified. Your listing is published.')
          await refresh()
          return
        }
        if (['failed', 'cancelled', 'expired', 'reversed', 'refunded'].includes(statusResult.data.status)) {
          setNotice('Payment was not completed. Your listing remains pending payment.')
          await refresh()
          return
        }
      }
      setNotice('Payment is still being verified. The listing will appear after confirmation.')
    } catch {
      setNotice('')
      setError('The publication payment could not be completed. Please try again.')
    } finally { setBusy(false) }
  }

  async function removeProduct(product: SellerProduct) {
    if (!window.confirm(`Remove “${product.title}” from the marketplace?`)) return
    setBusy(true)
    setError('')
    try {
      const response = await marketplaceFetch(`${sellerApi}/products/${product.reference}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await getError(response, 'The listing could not be removed.'))
      setEditing((current) => current?.id === product.id ? null : current)
      setNotice('Listing removed from active inventory. Payment and audit history are retained.')
      await refresh()
    } catch { setError('The listing could not be removed.') }
    finally { setBusy(false) }
  }

  function startEdit(product: SellerProduct) {
    setEditing(product)
    setDraft({ title: product.title, description: product.description, categoryId: product.categoryId, subcategoryId: product.subcategoryId, condition: product.condition, priceKes: product.priceKes, negotiable: product.negotiable })
    setError('')
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing || !draft) return
    setBusy(true)
    setError('')
    try {
      const response = await marketplaceFetch(`${sellerApi}/products/${editing.reference}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
      if (!response.ok) throw new Error(await getError(response, 'The listing could not be updated.'))
      setEditing(null)
      setDraft(null)
      await refresh()
    } catch { setError('The listing could not be updated.') }
    finally { setBusy(false) }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProfileBusy(true)
    setError('')
    setNotice('')
    try {
      const countyName = counties.find((county) => county.code === profileDraft.countyCode)?.name
      const response = await marketplaceFetch(`${sellerApi}/profile`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...profileDraft, subcounty: countyName ?? profileDraft.subcounty, town: countyName ?? profileDraft.town, area: '' }) })
      if (!response.ok) throw new Error(await getError(response, 'Profile changes could not be saved.'))
      const result = await response.json() as { data: SellerProfile }
      setProfile(result.data)
      setNotice('Seller profile saved.')
    } catch { setError('Profile changes could not be saved.') }
    finally { setProfileBusy(false) }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProfileBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await marketplaceFetch(`${sellerApi}/password`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(passwordDraft) })
      if (!response.ok) throw new Error(await getError(response, 'Password could not be changed.'))
      setPasswordDraft({ currentPassword: '', password: '', confirmPassword: '' })
      setNotice('Password changed. Other signed-in sessions were revoked.')
    } catch { setError('Password could not be changed.') }
    finally { setProfileBusy(false) }
  }

  const visibleProducts = products.filter((product) => (statusFilter === 'all' ? product.status !== 'removed' : product.status === statusFilter) && (!search.trim() || `${product.title} ${product.reference} ${product.category}`.toLowerCase().includes(search.trim().toLowerCase())))
  const dashboardProducts = products.filter((product) => product.status !== 'removed')
  const visibleOtherProducts = otherProducts.filter((product) => !search.trim() || `${product.title} ${product.category} ${product.town}`.toLowerCase().includes(search.trim().toLowerCase()))
  const publishedCount = products.filter((product) => product.status === 'published').length
  const pendingCount = products.filter((product) => product.status === 'pending_payment').length
  const soldCount = products.filter((product) => product.status === 'sold').length
  const expiredCount = products.filter((product) => product.status === 'expired').length
  const activeCount = products.filter((product) => product.publicAvailable).length
  const viewsChartData = buildViewsChartData(analytics?.dailyViews ?? [], viewsPeriod)
  const listingViews = analytics?.listingViews ?? 0
  const viewsChange = (analytics?.viewsLast30Days ?? 0) - (analytics?.viewsPrevious30Days ?? 0)
  const sectionName: Record<SellerSection, string> = { dashboard: 'Dashboard', listings: tab === 'marketplace' ? 'Other products' : 'My listings', orders: 'Orders & Sales', messages: 'Messages', analytics: 'Analytics', promotions: 'Promotions', payments: 'Payments & Earnings', reviews: 'Reviews & Ratings', profile: 'Profile & Settings', settings: 'Account Security', help: 'Help & Support' }
  const viewsChart = <section className="seller-analytics-panel"><header><div><span className="seller-eyebrow">LISTING PERFORMANCE</span><h2>Listing Views</h2><p>{listingViews.toLocaleString('en-KE')} lifetime views · {analytics?.viewsLast30Days.toLocaleString('en-KE') ?? 0} in the last 30 days</p></div><div className="seller-period-switch" role="group" aria-label="Views chart period">{(['daily', 'weekly', 'monthly'] as const).map((period) => <button type="button" className={viewsPeriod === period ? 'active' : ''} aria-pressed={viewsPeriod === period} key={period} onClick={() => setViewsPeriod(period)}>{period}</button>)}</div></header><div className="seller-chart-wrap"><SellerViewsChart data={viewsChartData} /></div><footer><span><i className="this-period" /> Selected period</span><span><i /> Previous period</span><b>{viewsChange >= 0 ? '+' : ''}{viewsChange.toLocaleString('en-KE')} views vs. prior 30 days</b></footer></section>
  const activityPanel = <section className="seller-activity-panel"><header><div><span className="seller-eyebrow">ACCOUNT HISTORY</span><h2>Recent Activity</h2></div><button type="button" className="seller-text-link" onClick={() => setSection('listings')}>View listings <ArrowRight size={14} /></button></header>{activity.length ? <ol>{activity.slice(0, 6).map((item, index) => <li key={`${item.action}-${item.reference ?? 'account'}-${item.createdAt}-${index}`}><span className="seller-activity-icon">{item.action === 'listing.published' ? <Check size={15} /> : item.action === 'seller.listing.sold' ? <ShoppingBag size={15} /> : <Activity size={15} />}</span><div><strong>{activityLabel(item.action)}</strong>{item.title && <span>{item.title}</span>}<time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</time></div></li>)}</ol> : <div className="seller-empty"><Clock3 size={22} /><strong>No activity recorded yet</strong><p>Listing updates will appear here.</p></div>}</section>
  return <div className="seller-dashboard-shell">
    <SellerPortalSidebar activeSection={section} menuOpen={menuOpen} onClose={() => setMenuOpen(false)} onSelectSection={(nextSection) => { setSection(nextSection); setTab('mine'); setEditing(null) }} />
    <div className="seller-dashboard-body">
      <header className="seller-dashboard-topbar"><button className="seller-menu-button" type="button" aria-label="Open seller navigation" onClick={() => setMenuOpen((open) => !open)}><Menu size={20} /></button><form className="seller-global-search" onSubmit={(event) => { event.preventDefault(); setSection('listings'); setMenuOpen(false) }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your products..." aria-label="Search products" /><button type="submit" aria-label="Search"><Search size={17} /></button></form><button className="seller-topbar-alert" type="button" aria-label="Messages" onClick={() => setSection('messages')}><Bell size={18} /></button><div className="seller-account-menu"><button className="seller-account-chip" type="button" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}><span>{profile?.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'S'}</span><b>{profile?.name.split(' ')[0] ?? 'Seller'}</b><ChevronDown size={14} /></button>{accountMenuOpen && <div className="seller-account-dropdown" role="menu"><button type="button" role="menuitem" onClick={() => { setSection('profile'); setAccountMenuOpen(false) }}><UserRound size={15} /> Profile &amp; Settings</button><button type="button" role="menuitem" onClick={() => void logout()}><LogOut size={15} /> Log out</button></div>}</div></header>
      <main className="seller-dashboard-content" onClickCapture={(event) => {
        const target = event.target instanceof HTMLElement ? event.target : null
        const link = target?.closest('a')
        const listingItem = link?.closest('.seller-listing-card-grid article, .seller-product-row')
        const status = listingItem?.querySelector('.seller-status')?.textContent?.trim().toLowerCase()
        const hrefSlug = link?.getAttribute('href')?.split('/').pop()
        const cardTitle = listingItem?.querySelector('.seller-listing-card-title, .seller-product-main > a')?.textContent
        const product = products.find((item) => item.slug === hrefSlug || item.title === cardTitle)
        if (link && listingItem && (product && !product.publicAvailable || status && status !== 'published')) {
          event.preventDefault()
          setNotice('This listing is not currently available on the public marketplace.')
        }
      }}>
        {error && <div className="seller-error" role="alert"><CircleAlert size={16} />{error}</div>}{notice && <p className="admin-success-message" role="status">{notice}</p>}
        {loading ? <div className="seller-loading">Loading your workspace…</div> : section === 'profile' ? <section className="seller-account-settings"><span className="seller-eyebrow">SELLER ACCOUNT</span><h1>Profile</h1><p>Keep your seller details current for marketplace listings.</p><form className="seller-settings-form" onSubmit={saveProfile}><label>Full name<input required minLength={2} maxLength={120} value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} /></label><label>Phone<input required inputMode="tel" value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} /></label><label>WhatsApp (optional)<input inputMode="tel" value={profileDraft.whatsapp} onChange={(event) => setProfileDraft({ ...profileDraft, whatsapp: event.target.value })} /></label><div className="seller-form-pair"><label>County<select required value={profileDraft.countyCode} onChange={(event) => setProfileDraft({ ...profileDraft, countyCode: event.target.value })}>{counties.map((county) => <option value={county.code} key={county.code}>{county.name}</option>)}</select></label><label>Subcounty<input required minLength={2} maxLength={100} value={profileDraft.subcounty} onChange={(event) => setProfileDraft({ ...profileDraft, subcounty: event.target.value })} /></label></div><div className="seller-form-pair"><label>Town<input required minLength={2} maxLength={100} value={profileDraft.town} onChange={(event) => setProfileDraft({ ...profileDraft, town: event.target.value })} /></label><label>Area (optional)<input maxLength={120} value={profileDraft.area} onChange={(event) => setProfileDraft({ ...profileDraft, area: event.target.value })} /></label></div><button className="seller-primary-button" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save profile'}</button></form></section>
          : section === 'settings' ? <section className="seller-account-settings"><span className="seller-eyebrow">ACCOUNT SECURITY</span><h1>Settings</h1><p>Change your password. Other signed-in seller sessions will be revoked.</p><form className="seller-settings-form" onSubmit={changePassword}><label>Current password<input required type="password" autoComplete="current-password" value={passwordDraft.currentPassword} onChange={(event) => setPasswordDraft({ ...passwordDraft, currentPassword: event.target.value })} /></label><label>New password<input required type="password" autoComplete="new-password" minLength={12} value={passwordDraft.password} onChange={(event) => setPasswordDraft({ ...passwordDraft, password: event.target.value })} /></label><label>Confirm new password<input required type="password" autoComplete="new-password" minLength={12} value={passwordDraft.confirmPassword} onChange={(event) => setPasswordDraft({ ...passwordDraft, confirmPassword: event.target.value })} /></label><button className="seller-primary-button" disabled={profileBusy}>{profileBusy ? 'Updating…' : 'Change password'}</button></form></section>
          : section === 'analytics' ? <section className="seller-analytics-page"><div className="seller-page-heading"><div><span className="seller-eyebrow">SELLER PERFORMANCE</span><h1>Analytics</h1><p>Views and verified contact unlocks from your marketplace listings.</p></div></div>{viewsChart}<section className="seller-views-ranking"><header><div><span className="seller-eyebrow">LISTING PERFORMANCE</span><h2>Views by listing</h2></div><span>{listingViews.toLocaleString('en-KE')} lifetime views</span></header>{[...(analytics?.viewsByListing ?? [])].sort((a, b) => b.views - a.views).map((item) => { const product = products.find((candidate) => candidate.reference === item.reference); return product ? <article key={item.reference}><span className="seller-product-thumb">{product.images[0] ? <img src={product.images[0].imageUrl} alt="" /> : <Box size={20} />}</span><div><strong>{product.title}</strong><small>{product.category} · {product.status.replaceAll('_', ' ')}</small></div><b><Eye size={14} /> {item.views.toLocaleString('en-KE')}</b></article> : null })}{products.length === 0 && <div className="seller-empty"><BarChart3 size={22} /><strong>No listing analytics yet</strong><p>Views will be recorded when buyers open your published listings.</p></div>}</section><section className="seller-views-ranking seller-paid-viewers"><header><div><span className="seller-eyebrow">VERIFIED CONTACT UNLOCKS</span><h2>Paid interested viewers</h2></div><span>{analytics?.interestedViewers.length ?? 0} records</span></header>{analytics?.interestedViewers.length ? analytics.interestedViewers.map((viewer, index) => <article key={`${viewer.reference}-${viewer.phone}-${viewer.paidAt ?? index}`}><span className="seller-paid-viewer-mark"><BadgeCheck size={17} /></span><div><strong>{viewer.name}</strong><small>{viewer.title} · {viewer.reference}</small></div><a href={`tel:${viewer.phone}`} aria-label={`Call ${viewer.name}`}>{viewer.phone}</a><time>{viewer.paidAt ? new Date(viewer.paidAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : 'Verified'}</time></article>) : <div className="seller-empty"><BadgeCheck size={22} /><strong>No paid viewers yet</strong><p>Verified contact unlocks will be listed here with the buyer name and phone number.</p></div>}</section></section>
          : ['promotions', 'payments', 'reviews'].includes(section) ? <section className="seller-feature-unavailable"><span className="seller-feature-icon">{section === 'promotions' ? <Megaphone /> : section === 'payments' ? <WalletCards /> : <BadgeCheck />}</span><span className="seller-eyebrow">{sectionName[section].toUpperCase()}</span><h1>{sectionName[section]}</h1><p>{section === 'promotions' ? 'Featured placement is managed by MarketHub administrators. Seller-funded promotions are not available.' : section === 'payments' ? 'The marketplace records publication and contact-unlock fees, but does not yet track seller earnings or payouts.' : 'Buyer reviews and ratings are not currently collected for marketplace listings.'}</p><Link className="seller-outline-button" to="/marketplace/sell">Create a listing <ArrowRight size={14} /></Link></section>
          : section === 'orders' ? <section className="seller-account-settings"><span className="seller-eyebrow">SALES</span><h1>Orders &amp; Sales</h1><p>MarketHub currently lets sellers mark a listing as sold, but does not have a buyer order or seller sales-payment ledger. Sold items below are seller-reported, not verified payments.</p><div className="seller-status-summary"><span>Seller-marked sold<strong>{soldCount}</strong></span><span>Published listings<strong>{publishedCount}</strong></span><span>Pending publication<strong>{pendingCount}</strong></span></div>{products.filter((product) => product.status === 'sold').length > 0 && <div className="seller-product-list">{products.filter((product) => product.status === 'sold').map((product) => <article className="seller-product-row" key={product.id}><span className="seller-product-thumb">{product.images[0] ? <img src={product.images[0].imageUrl} alt="" /> : <Box size={22} />}</span><div className="seller-product-main"><strong>{product.title}</strong><span>{product.category} · {product.reference}</span></div><div className="seller-product-price"><strong>{formatKes(product.priceKes)}</strong><span className="seller-status status-sold">Sold</span></div></article>)}</div>}</section>
          : section === 'messages' ? <section className="seller-account-settings"><span className="seller-eyebrow">BUYER COMMUNICATION</span><h1>Messages</h1><div className="seller-unavailable"><MessageSquareText size={24} /><strong>Marketplace messaging isn’t available</strong><p>Buyers currently contact sellers through the protected contact-unlock flow on each listing. Messages are not stored in a seller inbox.</p></div></section>
          : section === 'help' ? <section className="seller-account-settings"><span className="seller-eyebrow">MARKETHUB SUPPORT</span><h1>Help &amp; Support</h1><p>Need help with your seller account or a listing?</p><div className="seller-help-links"><a href="mailto:hello@markethub.co.ke"><CircleHelp size={18} /><span><strong>Email MarketHub support</strong><small>hello@markethub.co.ke</small></span><ArrowRight size={16} /></a><Link to="/marketplace"><Store size={18} /><span><strong>Browse the marketplace</strong><small>Review your live products as buyers see them</small></span><ArrowRight size={16} /></Link></div></section>
          : <>
            {section === 'dashboard' && <>
              <section className="seller-dashboard-hero"><div className="seller-dashboard-hero-copy"><span>SELLER PORTAL</span><h1>Welcome back, {profile?.name.split(' ')[0] ?? 'Seller'}!</h1><h2>Here’s what’s happening with your MarketHub account.</h2><Link className="seller-primary-button" to="/marketplace/sell"><Plus size={16} /> Add Listing</Link></div><div className="seller-hero-actions"><button type="button" className="seller-topbar-alert" aria-label="Open recent activity" onClick={() => document.getElementById('seller-recent-activity')?.scrollIntoView({ behavior: 'smooth' })}><Bell size={19} /></button><button type="button" className="seller-account-chip" onClick={() => setSection('profile')}><span>{profile?.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'S'}</span><b>{profile?.name.split(' ')[0] ?? 'Seller'}</b><UserRound size={14} /></button></div></section>
              <div className="seller-metric-grid"><button type="button" onClick={() => { setSection('listings'); setStatusFilter('published') }}><span><Tag /></span><small>Active Listings</small><strong>{activeCount}</strong><em>Currently available</em></button><button type="button" onClick={() => setSection('orders')}><span><ShoppingBag /></span><small>New Orders</small><strong>Not tracked</strong><em>No order ledger available</em></button><button type="button" onClick={() => setSection('payments')}><span><WalletCards /></span><small>Total Sales</small><strong>Not tracked</strong><em>Seller sales are not recorded</em></button><button type="button" onClick={() => setSection('analytics')}><span><Eye /></span><small>Listing Views</small><strong>{listingViews.toLocaleString('en-KE')}</strong><em>{analytics?.viewsLast30Days.toLocaleString('en-KE') ?? 0} in last 30 days</em></button></div>
              <section className="seller-listing-preview"><header><div><span className="seller-eyebrow">YOUR CATALOGUE</span><h2>Your Listings</h2></div><button type="button" className="seller-text-link" onClick={() => setSection('listings')}>View all <ArrowRight size={14} /></button></header><div className="seller-listing-card-grid">{dashboardProducts.slice(0, 4).map((product) => <article key={product.id}><Link to={product.publicAvailable ? `/marketplace/products/${product.slug}` : '#'} onClick={(event) => { if (!product.publicAvailable) { event.preventDefault(); setNotice('This listing is not currently available on the public marketplace.') } }} className="seller-listing-card-image"><SellerProductImage src={product.images[0]?.imageUrl} alt={product.title} size={28} /><span className={`seller-status status-${product.status}`}>{product.status.replaceAll('_', ' ')}</span></Link><Link className="seller-listing-card-title" to={product.publicAvailable ? `/marketplace/products/${product.slug}` : '/marketplace/seller'}>{product.title}</Link><strong>{formatKes(product.priceKes)}</strong><small><Eye size={13} /> {analytics?.viewsByListing.find((item) => item.reference === product.reference)?.views ?? 0} views</small><div className="seller-listing-card-actions"><button type="button" title="Edit listing" aria-label={`Edit ${product.title}`} onClick={() => { setSection('listings'); startEdit(product) }}><Pencil size={14} /></button>{product.status === 'pending_payment' && <button type="button" title="Retry publication payment" aria-label={`Retry payment for ${product.title}`} disabled={busy} onClick={() => void retryPublicationPayment(product)}><WalletCards size={14} /></button>}{product.status === 'published' && <button type="button" title="Mark sold" aria-label={`Mark ${product.title} sold`} onClick={() => void markSold(product)}><Check size={14} /></button>}<button type="button" title="Remove listing" aria-label={`Remove ${product.title}`} onClick={() => void removeProduct(product)}><Trash2 size={14} /></button></div></article>)}{dashboardProducts.length === 0 && <div className="seller-empty"><Box size={22} /><strong>No listings yet</strong><p>Create a listing to start showing up in the marketplace.</p><Link className="seller-primary-button" to="/marketplace/sell"><Plus size={15} /> Add Listing</Link></div>}</div></section>
              <div className="seller-dashboard-lower"><div>{viewsChart}</div><div id="seller-recent-activity">{activityPanel}<section className="seller-account-health"><span className="seller-account-health-icon"><BadgeCheck size={20} /></span><div><strong>Seller account verified</strong><p>{profile?.town}, {profile?.county}</p></div><button type="button" className="seller-outline-button" onClick={() => setSection('profile')}>Manage account <ArrowRight size={14} /></button></section></div></div>
            </>}
            <div data-section={section} className={`seller-dashboard-columns${section === 'listings' ? ' is-listings' : ''}`}>
              <div className="seller-dashboard-products"><div className="seller-dashboard-section-heading"><div><span className="seller-eyebrow">{section === 'dashboard' ? 'YOUR CATALOGUE' : 'MARKETPLACE CATALOGUE'}</span><h2>{section === 'dashboard' ? 'My Listings' : sectionName[section]}</h2></div>{section === 'dashboard' && <button className="seller-text-link" type="button" onClick={() => setSection('listings')}>View All <ArrowRight size={14} /></button>}</div>
                <div className="seller-portal-page"><SellerHeader profile={profile} /><main className="seller-portal-main">
    <div className="seller-portal-heading"><div><span className="seller-eyebrow">SELLER WORKSPACE</span><h1>{profile ? `Welcome, ${profile.name.split(' ')[0]}` : 'Your products'}</h1><p><MapPin size={14} /> {profile ? `${profile.town}, ${profile.county}` : 'Marketplace Kenya'}</p></div><div><Link className="seller-outline-button" to="/marketplace">Browse marketplace</Link><button className="seller-icon-button" type="button" title="Sign out" aria-label="Sign out" onClick={() => void logout()}><LogOut size={17} /></button></div></div>
    <div className="seller-tabs" role="tablist" aria-label="Seller products"><button role="tab" aria-selected={tab === 'mine'} onClick={() => { setTab('mine'); setEditing(null) }}><Box size={16} />My products <span>{products.length}</span></button><button role="tab" aria-selected={tab === 'marketplace'} onClick={() => { setTab('marketplace'); setEditing(null) }}><Search size={16} />Other products <span>{otherProducts.length}</span></button></div>
    {error && <div className="seller-error" role="alert"><CircleAlert size={16} />{error}</div>}
    {loading ? <div className="seller-loading">Loading your workspace…</div> : tab === 'mine' ? <>
      <div className="seller-toolbar"><div><h2>Products you posted</h2><p>{products.length} total listing{products.length === 1 ? '' : 's'}</p></div><div><label className="seller-status-filter">Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All products</option><option value="published">Published</option><option value="pending_payment">Pending payment</option><option value="sold">Sold</option><option value="expired">Expired</option><option value="removed">Removed</option></select></label><Link className="seller-primary-button" to="/marketplace/sell"><Plus size={16} /> Add product</Link></div></div>
      {editing && draft && <form className="seller-edit-form" onSubmit={saveEdit}><header><div><span className="seller-eyebrow">EDIT LISTING</span><h2>{editing.title}</h2></div><button className="seller-icon-button" type="button" aria-label="Close edit form" onClick={() => setEditing(null)}><X size={17} /></button></header>
        <label>Product title<input required minLength={5} maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>Description<textarea required minLength={30} maxLength={5000} rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <div className="seller-form-pair"><label>Category<select required value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value, subcategoryId: null })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Subcategory<select value={draft.subcategoryId ?? ''} onChange={(event) => setDraft({ ...draft, subcategoryId: event.target.value || null })}><option value="">No subcategory</option>{categories.find((category) => category.id === draft.categoryId)?.subcategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        <div className="seller-form-pair"><label>Condition<select value={draft.condition} onChange={(event) => setDraft({ ...draft, condition: event.target.value })}><option value="new">New</option><option value="like_new">Like new</option><option value="good">Good</option><option value="fair">Fair</option><option value="used">Used</option></select></label><label>Price (KSh)<input required type="number" min="1" max="100000000" step="1" value={draft.priceKes} onChange={(event) => setDraft({ ...draft, priceKes: Number(event.target.value) })} /></label></div>
        <label className="seller-negotiable"><input type="checkbox" checked={draft.negotiable} onChange={(event) => setDraft({ ...draft, negotiable: event.target.checked })} /> Price is negotiable</label><div className="seller-edit-actions"><button className="seller-outline-button" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="seller-primary-button" disabled={busy}>{busy ? 'Saving…' : <>Save changes <Check size={15} /></>}</button></div>
      </form>}
      <div className="seller-product-list">{visibleProducts.map((product) => <article className="seller-product-row" key={product.id}><Link to={product.publicAvailable ? `/marketplace/products/${product.slug}` : '/marketplace/seller'} className="seller-product-thumb"><SellerProductImage src={product.images[0]?.imageUrl} size={24} /></Link><div className="seller-product-main"><Link to={product.publicAvailable ? `/marketplace/products/${product.slug}` : '/marketplace/seller'}><strong>{product.title}</strong></Link><span>{product.category} · {product.reference}</span><small>{new Date(product.createdAt).toLocaleDateString('en-KE')}</small></div><div className="seller-product-price"><strong>{formatKes(product.priceKes)}</strong><span className={`seller-status status-${product.status}`}>{product.status.replaceAll('_', ' ')}</span></div><div className="seller-product-actions">{['published', 'pending_payment', 'expired'].includes(product.status) && <button className="seller-icon-button" type="button" title="Edit product" aria-label={`Edit ${product.title}`} onClick={() => startEdit(product)}><Pencil size={16} /></button>}{product.status === 'pending_payment' && <button className="seller-icon-button" type="button" title="Retry publication payment" aria-label={`Retry payment for ${product.title}`} disabled={busy} onClick={() => void retryPublicationPayment(product)}><WalletCards size={16} /></button>}{product.status === 'published' && <button className="seller-icon-button" type="button" title="Mark as sold" aria-label={`Mark ${product.title} as sold`} disabled={busy} onClick={() => void markSold(product)}><Check size={16} /></button>}{product.status !== 'removed' && <button className="seller-icon-button is-danger" type="button" title="Remove listing" aria-label={`Remove ${product.title}`} disabled={busy} onClick={() => void removeProduct(product)}><Trash2 size={16} /></button>}</div></article>)}{!visibleProducts.length && <div className="seller-empty"><Box size={22} /><strong>{statusFilter === 'all' ? 'No products posted yet' : 'No products in this status'}</strong><p>{statusFilter === 'all' ? 'Add your first item to start selling.' : 'Choose another status to see more of your products.'}</p>{statusFilter === 'all' && <Link className="seller-primary-button" to="/marketplace/sell"><Plus size={15} /> Add product</Link>}</div>}</div>
    </> : <><div className="seller-toolbar"><div><h2>Other products for sale</h2><p>Discover items listed by other sellers.</p></div><Link className="seller-outline-button" to="/marketplace">View all products <ArrowRight size={15} /></Link></div><div className="seller-other-grid">{visibleOtherProducts.map((product) => <Link className="seller-other-product" key={product.slug} to={`/marketplace/products/${product.slug}`}><span className="seller-other-image">{product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" /> : <Box size={27} />}</span><span className="seller-other-category">{product.category}</span><strong>{product.title}</strong><span className="seller-other-location"><MapPin size={12} /> {product.town}, {product.county}</span><b>{formatKes(product.priceKes)}</b></Link>)}{!visibleOtherProducts.length && <div className="seller-empty"><Search size={22} /><strong>No other products match this search</strong><p>Try a different search term.</p></div>}</div></>}
    <footer className="seller-portal-footer"><ShieldCheck size={15} /> Your contact information is protected and only shared after verified buyer payment.</footer>
  </main></div></div>
              {section === 'dashboard' && <aside className="seller-dashboard-aside"><section className="seller-insight-panel"><header><div><span className="seller-eyebrow">CATALOGUE HEALTH</span><h2>Listing Overview</h2></div><button className="seller-period-button" type="button" disabled><CalendarDays size={13} /> Current</button></header>{[{ label: 'Published', value: publishedCount, color: 'green' }, { label: 'Pending payment', value: pendingCount, color: 'amber' }, { label: 'Sold', value: soldCount, color: 'blue' }, { label: 'Expired', value: expiredCount, color: 'gray' }].map((item) => <div className="seller-progress-row" key={item.label}><div><span>{item.label}</span><strong>{item.value}</strong></div><span className="seller-progress-track"><i className={`is-${item.color}`} style={{ width: `${products.length ? Math.max(4, item.value / products.length * 100) : 0}%` }} /></span></div>)}</section><section className="seller-tips-panel"><span className="seller-eyebrow"><Leaf size={13} /> SELLER TIPS</span><ul><li>Use clear, well-lit product photos.</li><li>Write accurate descriptions and condition.</li><li>Set a fair, competitive price.</li><li>Mark items sold when they are no longer available.</li></ul></section></aside>}
            </div>
          </>}
      </main>
    </div>
  </div>
}