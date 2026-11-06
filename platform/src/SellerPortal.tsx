import { useEffect, useEffectEvent, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, BadgeCheck, Box, Check, CircleAlert, LogOut, MapPin, Pencil, Plus, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

type County = { code: string; name: string }
type SellerProfile = { id: string; email: string; sellerId: string; name: string; phone: string; whatsapp: string | null; countyCode: string; county: string; subcounty: string; town: string; area: string | null }
type SellerImage = { id: string; imageUrl: string; isPrimary: boolean; sortOrder: number }
type SellerProduct = { id: string; reference: string; slug: string; title: string; description: string; condition: string; priceKes: number; negotiable: boolean; status: string; categoryId: string; category: string; subcategoryId: string | null; createdAt: string; images: SellerImage[] }
type OtherProduct = { slug: string; title: string; priceKes: number; category: string; county: string; town: string; imageUrl: string | null; condition: string }
type Category = { id: string; name: string; subcategories: { id: string; name: string }[] }
type ProductDraft = Pick<SellerProduct, 'title' | 'description' | 'categoryId' | 'subcategoryId' | 'condition' | 'priceKes' | 'negotiable'>

const sellerApi = '/api/v1/marketplace/seller'
const formatKes = (value: number) => `KSh ${new Intl.NumberFormat('en-KE').format(value)}`

async function getError(response: Response, fallback: string) {
  const result = await response.json().catch(() => ({})) as { error?: { message?: string } }
  return result.error?.message ?? fallback
}

function SellerHeader({ profile }: { profile?: SellerProfile | null }) {
  return <header className="seller-portal-header"><Link className="market-brand" to="/marketplace"><span className="market-logo"><Box size={25} /></span><span><strong>Market<span>hub</span></strong><small>Buy. Sell. Reuse. Save.</small></span></Link><nav><Link to="/marketplace">Marketplace</Link>{profile ? <Link to="/marketplace/seller">My account</Link> : <Link to="/marketplace/seller/login">Seller sign in</Link>}</nav></header>
}

export function SellerSignupPage() {
  const [counties, setCounties] = useState<County[]>([])
  const [loadingCounties, setLoadingCounties] = useState(true)
  const [error, setError] = useState('')
  const [pendingEmail, setPendingEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [values, setValues] = useState({ name: '', email: '', phone: '', whatsapp: '', countyCode: '', subcounty: '', town: '', area: '', password: '', confirmPassword: '' })

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/marketplace/locations/counties', { signal: controller.signal }).then(async (response) => {
      const result = await response.json() as { data?: County[]; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'County information is unavailable.')
      setCounties(result.data)
      setValues((current) => ({ ...current, countyCode: result.data?.[0]?.code ?? '' }))
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'County information is unavailable.') })
      .finally(() => { if (!controller.signal.aborted) setLoadingCounties(false) })
    return () => controller.abort()
  }, [])

  const update = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }))
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${sellerApi}/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) })
      if (!response.ok) throw new Error(await getError(response, 'Seller registration failed.'))
      setPendingEmail(values.email)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Seller registration failed.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="seller-auth-page"><SellerHeader /><main className="seller-auth-main">
    <Link to="/marketplace" className="back-link"><ArrowLeft size={15} /> Marketplace</Link>
    {pendingEmail ? <section className="seller-auth-card seller-verified-state"><span className="seller-auth-icon"><BadgeCheck /></span><span className="seller-eyebrow">ONE MORE STEP</span><h1>Check your email</h1><p>We sent a verification link to <strong>{pendingEmail}</strong>. Verify your address before signing in.</p><Link className="seller-primary-button" to="/marketplace/seller/login">Continue to sign in <ArrowRight size={16} /></Link></section> : <section className="seller-auth-card">
      <span className="seller-eyebrow">SELLER ACCOUNT</span><h1>Create your account</h1><p>Verify your email to manage your listings in one place.</p>
      {error && <div className="seller-error" role="alert"><CircleAlert size={16} />{error}</div>}
      <form className="seller-account-form" onSubmit={submit}>
        <label>Full name<input required minLength={2} maxLength={120} autoComplete="name" value={values.name} onChange={(event) => update('name', event.target.value)} /></label>
        <label>Email address<input required type="email" maxLength={254} autoComplete="email" value={values.email} onChange={(event) => update('email', event.target.value)} /></label>
        <div className="seller-form-pair"><label>Phone<input required inputMode="tel" autoComplete="tel" value={values.phone} onChange={(event) => update('phone', event.target.value)} placeholder="0712 345 678" /></label><label>WhatsApp (optional)<input inputMode="tel" value={values.whatsapp} onChange={(event) => update('whatsapp', event.target.value)} /></label></div>
        <div className="seller-form-pair"><label>County<select required disabled={loadingCounties} value={values.countyCode} onChange={(event) => update('countyCode', event.target.value)}><option value="">Select county</option>{counties.map((county) => <option key={county.code} value={county.code}>{county.name}</option>)}</select></label><label>Subcounty<input required minLength={2} maxLength={100} value={values.subcounty} onChange={(event) => update('subcounty', event.target.value)} /></label></div>
        <div className="seller-form-pair"><label>Town<input required minLength={2} maxLength={100} value={values.town} onChange={(event) => update('town', event.target.value)} /></label><label>Area (optional)<input maxLength={120} value={values.area} onChange={(event) => update('area', event.target.value)} /></label></div>
        <label>Password<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={values.password} onChange={(event) => update('password', event.target.value)} /></label>
        <label>Confirm password<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={values.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)} /></label>
        <button className="seller-primary-button" disabled={busy || loadingCounties || !counties.length}>{busy ? 'Creating account…' : <>Create seller account <ArrowRight size={16} /></>}</button>
      </form>
      <p className="seller-auth-switch">Already registered? <Link to="/marketplace/seller/login">Sign in</Link></p>
    </section>}
  </main></div>
}

export function SellerLoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${sellerApi}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      if (!response.ok) throw new Error(await getError(response, 'Sign in failed.'))
      navigate('/marketplace/seller', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }
  return <div className="seller-auth-page"><SellerHeader /><main className="seller-auth-main"><Link to="/marketplace" className="back-link"><ArrowLeft size={15} /> Marketplace</Link><section className="seller-auth-card">
    <span className="seller-eyebrow">SELLER ACCOUNT</span><h1>Welcome back</h1><p>Sign in to manage your products and browse the marketplace.</p>
    {error && <div className="seller-error" role="alert"><CircleAlert size={16} />{error}</div>}
    <form className="seller-account-form" onSubmit={submit}><label>Email address<input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="seller-primary-button" disabled={busy}>{busy ? 'Signing in…' : <>Sign in <ArrowRight size={16} /></>}</button></form>
    <p className="seller-auth-switch">New to selling? <Link to="/marketplace/seller/signup">Create seller account</Link></p>
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
    fetch(`${sellerApi}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(await getError(response, 'Email verification failed.'))
      setMessage('Your email is verified. You can now sign in and manage your listings.')
    }).catch((reason: unknown) => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : 'Email verification failed.'); setMessage('') } })
    return () => controller.abort()
  }, [token])
  return <div className="seller-auth-page"><SellerHeader /><main className="seller-auth-main"><section className="seller-auth-card seller-verified-state"><span className={`seller-auth-icon${displayError ? ' is-error' : ''}`}>{displayError ? <CircleAlert /> : <BadgeCheck />}</span><span className="seller-eyebrow">SELLER ACCOUNT</span><h1>{displayError ? 'Verification failed' : message === 'Verifying your email…' ? 'Verifying your email' : 'Email verified'}</h1>{displayError ? <p className="seller-error" role="alert">{displayError}</p> : <p>{message}</p>}{message !== 'Verifying your email…' && !displayError && <button className="seller-primary-button" type="button" onClick={() => navigate('/marketplace/seller/login', { replace: true })}>Continue to sign in <ArrowRight size={16} /></button>}{displayError && <Link className="seller-primary-button" to="/marketplace/seller/signup">Return to registration</Link>}</section></main></div>
}

export function SellerPortalPage() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<SellerProfile | null>(null)
  const [products, setProducts] = useState<SellerProduct[]>([])
  const [otherProducts, setOtherProducts] = useState<OtherProduct[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [tab, setTab] = useState<'mine' | 'marketplace'>('mine')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editing, setEditing] = useState<SellerProduct | null>(null)
  const [draft, setDraft] = useState<ProductDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const setProfileFromSession = useEffectEvent((value: SellerProfile) => setProfile(value))

  async function loadProducts(signal?: AbortSignal) {
    const [mineResponse, otherResponse, categoryResponse] = await Promise.all([
      fetch(`${sellerApi}/products`, { signal }),
      fetch('/api/v1/marketplace/products?limit=24', { signal }),
      fetch('/api/v1/marketplace/categories', { signal }),
    ])
    if (!mineResponse.ok) throw new Error(await getError(mineResponse, 'Your products could not be loaded.'))
    if (!otherResponse.ok) throw new Error(await getError(otherResponse, 'Marketplace products could not be loaded.'))
    if (!categoryResponse.ok) throw new Error(await getError(categoryResponse, 'Product categories could not be loaded.'))
    const mine = await mineResponse.json() as { data: SellerProduct[] }
    const others = await otherResponse.json() as { data: OtherProduct[] }
    const categoryData = await categoryResponse.json() as { data: Category[] }
    setProducts(mine.data)
    setOtherProducts(others.data)
    setCategories(categoryData.data)
  }

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetch(`${sellerApi}/session`, { signal: controller.signal }).then(async (response) => {
        if (response.status === 401) { navigate('/marketplace/seller/login', { replace: true }); return }
        if (!response.ok) throw new Error(await getError(response, 'Seller account could not be loaded.'))
        const result = await response.json() as { data: SellerProfile }
        setProfileFromSession(result.data)
      }),
      loadProducts(controller.signal),
    ]).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Seller products could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [navigate])

  async function refresh() {
    setError('')
    try { await loadProducts() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Products could not be refreshed.') }
  }

  async function logout() {
    await fetch(`${sellerApi}/logout`, { method: 'POST' })
    navigate('/marketplace/seller/login', { replace: true })
  }

  async function markSold(product: SellerProduct) {
    if (!window.confirm(`Mark “${product.title}” as sold?`)) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${sellerApi}/products/${product.reference}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'sold' }) })
      if (!response.ok) throw new Error(await getError(response, 'The listing could not be marked as sold.'))
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The listing could not be marked as sold.') }
    finally { setBusy(false) }
  }

  async function removeProduct(product: SellerProduct) {
    if (!window.confirm(`Remove “${product.title}” from the marketplace?`)) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${sellerApi}/products/${product.reference}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await getError(response, 'The listing could not be removed.'))
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The listing could not be removed.') }
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
      const response = await fetch(`${sellerApi}/products/${editing.reference}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
      if (!response.ok) throw new Error(await getError(response, 'The listing could not be updated.'))
      setEditing(null)
      setDraft(null)
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The listing could not be updated.') }
    finally { setBusy(false) }
  }

  const visibleProducts = products.filter((product) => statusFilter === 'all' || product.status === statusFilter)
  return <div className="seller-portal-page"><SellerHeader profile={profile} /><main className="seller-portal-main">
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
      <div className="seller-product-list">{visibleProducts.map((product) => <article className="seller-product-row" key={product.id}><Link to={`/marketplace/products/${product.slug}`} className="seller-product-thumb">{product.images[0] ? <img src={product.images[0].imageUrl} alt="" /> : <Box size={24} />}</Link><div className="seller-product-main"><Link to={`/marketplace/products/${product.slug}`}><strong>{product.title}</strong></Link><span>{product.category} · {product.reference}</span><small>{new Date(product.createdAt).toLocaleDateString('en-KE')}</small></div><div className="seller-product-price"><strong>{formatKes(product.priceKes)}</strong><span className={`seller-status status-${product.status}`}>{product.status.replaceAll('_', ' ')}</span></div><div className="seller-product-actions">{['published', 'pending_payment', 'expired'].includes(product.status) && <button className="seller-icon-button" type="button" title="Edit product" aria-label={`Edit ${product.title}`} onClick={() => startEdit(product)}><Pencil size={16} /></button>}{product.status === 'published' && <button className="seller-icon-button" type="button" title="Mark as sold" aria-label={`Mark ${product.title} as sold`} disabled={busy} onClick={() => void markSold(product)}><Check size={16} /></button>}{product.status !== 'removed' && <button className="seller-icon-button is-danger" type="button" title="Remove listing" aria-label={`Remove ${product.title}`} disabled={busy} onClick={() => void removeProduct(product)}><Trash2 size={16} /></button>}</div></article>)}{!visibleProducts.length && <div className="seller-empty"><Box size={22} /><strong>{statusFilter === 'all' ? 'No products posted yet' : 'No products in this status'}</strong><p>{statusFilter === 'all' ? 'Add your first item to start selling.' : 'Choose another status to see more of your products.'}</p>{statusFilter === 'all' && <Link className="seller-primary-button" to="/marketplace/sell"><Plus size={15} /> Add product</Link>}</div>}</div>
    </> : <><div className="seller-toolbar"><div><h2>Other products for sale</h2><p>Discover items listed by other sellers.</p></div><Link className="seller-outline-button" to="/marketplace">View all products <ArrowRight size={15} /></Link></div><div className="seller-other-grid">{otherProducts.map((product) => <Link className="seller-other-product" key={product.slug} to={`/marketplace/products/${product.slug}`}><span className="seller-other-image">{product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" /> : <Box size={27} />}</span><span className="seller-other-category">{product.category}</span><strong>{product.title}</strong><span className="seller-other-location"><MapPin size={12} /> {product.town}, {product.county}</span><b>{formatKes(product.priceKes)}</b></Link>)}{!otherProducts.length && <div className="seller-empty"><Search size={22} /><strong>No other products are available</strong><p>Check back soon for newly published listings.</p></div>}</div></>}
    <footer className="seller-portal-footer"><ShieldCheck size={15} /> Your contact information is protected and only shared after verified buyer payment.</footer>
  </main></div>
}