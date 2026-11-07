import { ArrowRight, BadgeCheck, CircleHelp, Compass, House, LayoutGrid, List as ListIcon, MapPin, Phone, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, X, Zap } from 'lucide-react'
import { FaFacebookF, FaWhatsapp, FaXTwitter, FaYoutube } from 'react-icons/fa6'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import { SellListingPage, SubmissionStatusPage } from './SellListingPage'
import { MarketplaceAdminPage } from './MarketplaceAdmin'
import { SellerForgotPasswordPage, SellerLoginPage, SellerPortalPage, SellerResetPasswordPage, SellerSignupPage, SellerVerifyPage } from './SellerPortal'

const kitzOrigin = import.meta.env.VITE_KITZ_ORIGIN || 'https://kitz.onrender.com'
const formatKes = (value: number) => `KSh ${new Intl.NumberFormat('en-KE').format(value)}`

type Listing = {
  reference: string
  slug: string
  title: string
  description: string
  condition: string
  priceKes: number
  negotiable: boolean
  featured: boolean
  publishedAt: string | null
  category: string
  categorySlug: string
  county: string
  subcounty: string
  town: string
  imageUrl: string | null
  contactUnlockFeeKes?: number
}

type MarketplaceCategory = { id: string; name: string; slug: string }
type MarketplaceCounty = { code: string; name: string }
type FooterSocialLinks = { facebookUrl: string | null; xUrl: string | null; youtubeUrl: string | null; whatsappUrl: string | null }
type CatalogueFilters = { county: string; subcounty: string; town: string; condition: string; minPrice: string; maxPrice: string; publishedAfter: string; publishedBefore: string; negotiable: string; sort: string; featured: string }
const categoryIcons: Record<string, string> = {
  'phones-and-accessories': '📱', 'computers-and-laptops': '💻', electronics: '🖥️', furniture: '🛋️',
  'home-appliances': '🧊', vehicles: '🚘', 'motorcycles-and-spare-parts': '🏍️', 'fashion-and-clothing': '👕',
  'shoes-and-bags': '👟', property: '🏠', 'construction-equipment': '🏗️', 'agriculture-and-farming-equipment': '🌱',
  'sports-and-fitness': '🏃', 'musical-instruments': '🎸', 'business-equipment': '🧰', 'other-products': '••',
}

function ProductResults({ search, category, filterQuery, page, view, onPageChange }: { search: string; category: string; filterQuery: string; page: number; view: 'grid' | 'list'; onPageChange: (page: number) => void }) {
  const [listings, setListings] = useState<Listing[]>([])
  const [pagination, setPagination] = useState<{ page: number; limit: number; total: number; hasMore: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams(filterQuery)
    params.set('limit', '12')
    params.set('page', String(page))
    if (search) params.set('q', search)
    if (category) params.set('category', category)
    setLoading(true)
    setError('')
    fetch(`/api/v1/marketplace/products?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { data?: Listing[]; pagination?: { page: number; limit: number; total: number; hasMore: boolean }; error?: { message?: string } }
        if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Listings could not be loaded.')
        setListings(result.data)
        setPagination(result.pagination ?? null)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Listings could not be loaded.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [search, category, filterQuery, page, retry])

  if (loading) return <div className={`listing-grid ${view === 'list' ? 'list-view' : ''}`} aria-label="Loading listings">{Array.from({ length: 4 }, (_, index) => <div className="listing-skeleton" key={index} />)}</div>
  if (error) return <div className="catalogue-message" role="alert"><strong>Listings are unavailable.</strong><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>
  if (!listings.length) return <div className="catalogue-message"><strong>No listings found.</strong><span>Try a different search or category.</span></div>
  return <>
    <div className={`listing-grid ${view === 'list' ? 'list-view' : ''}`}>{listings.map((listing) => <article className="listing-card" key={listing.reference}>
      <Link to={`/marketplace/products/${encodeURIComponent(listing.slug)}`} className="listing-image">
        {listing.imageUrl ? <img src={listing.imageUrl} alt={listing.title} loading="lazy" /> : <span aria-label="No product image">No image</span>}
        {listing.featured && <b>Featured</b>}
      </Link>
      <div className="listing-info"><small><MapPin size={11} /> {listing.town}, {listing.county}</small><Link to={`/marketplace/products/${encodeURIComponent(listing.slug)}`}><strong>{listing.title}</strong></Link><div><b>KSh {new Intl.NumberFormat('en-KE').format(listing.priceKes)}</b><span>{listing.negotiable ? 'Negotiable' : listing.condition.replaceAll('_', ' ')}</span></div></div>
      <Link className="listing-whatsapp-cta" to={`/marketplace/products/${encodeURIComponent(listing.slug)}?intent=whatsapp`} aria-label={`Pay contact fee to reach the seller of ${listing.title} on WhatsApp`}><FaWhatsapp size={15} /> WhatsApp seller</Link>
    </article>)}</div>
    {pagination && pagination.total > pagination.limit && <nav className="catalogue-pagination" aria-label="Product pages"><button type="button" disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>Previous</button><span>Page {pagination.page} · {pagination.total} listings</span><button type="button" disabled={!pagination.hasMore} onClick={() => onPageChange(pagination.page + 1)}>Next</button></nav>}
  </>
}

function MarketplaceProductPage() {
  const { slug = '' } = useParams()
  const [searchParams] = useSearchParams()
  const whatsappIntent = searchParams.get('intent') === 'whatsapp'
  const [listing, setListing] = useState<(Listing & { images: string[]; contactUnlockFeeKes: number }) | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedImage, setSelectedImage] = useState(0)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [contact, setContact] = useState<{ name: string; phone: string; whatsapp: string | null; email: string | null } | null>(null)
  const [unlockToken, setUnlockToken] = useState(() => sessionStorage.getItem(`mh_unlock_token_${slug}`) ?? '')
  const [unlockMessage, setUnlockMessage] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [paymentPanelOpen, setPaymentPanelOpen] = useState(whatsappIntent)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportMessage, setReportMessage] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetch(`/api/v1/marketplace/products/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { data?: Listing & { images: string[]; contactUnlockFeeKes: number }; error?: { message?: string } }
        if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'This listing is unavailable.')
        setListing(result.data)
        setSelectedImage(0)
        void fetch(`/api/v1/marketplace/products/${encodeURIComponent(slug)}/views`, { method: 'POST', signal: controller.signal }).catch(() => undefined)
        const savedToken = sessionStorage.getItem(`mh_unlock_token_${slug}`)
        if (savedToken) {
          setUnlockToken(savedToken)
          const contactResponse = await fetch(`/api/v1/marketplace/payments/products/${encodeURIComponent(slug)}/contact`, { method: 'POST', headers: { 'X-Unlock-Token': savedToken }, signal: controller.signal })
          if (contactResponse.ok) {
            const contactResult = await contactResponse.json() as { data: { name: string; phone: string; whatsapp: string | null; email: string | null } }
            setContact(contactResult.data)
          }
        }
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'This listing is unavailable.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [slug])

  async function unlockSellerContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!listing) return
    setUnlocking(true)
    setUnlockMessage('')
    try {
      const response = await fetch('/api/v1/marketplace/payments/contact-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, phone, email }),
      })
      const result = await response.json() as { data?: { paymentReference: string; accessToken: string; status: string }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Contact unlock could not be started.')
      const { accessToken, paymentReference } = result.data
      setUnlockToken(accessToken)
      sessionStorage.setItem(`mh_unlock_token_${slug}`, accessToken)
      sessionStorage.setItem(`mh_unlock_payment_${slug}`, paymentReference)
      setUnlockMessage('Approve the M-Pesa prompt on your phone.')
      for (let attempt = 0; attempt < 36; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500))
        const statusResponse = await fetch(`/api/v1/marketplace/payments/${paymentReference}/status`, { headers: { 'X-Payment-Token': accessToken } })
        const statusResult = await statusResponse.json() as { data?: { status: string }; error?: { message?: string } }
        if (!statusResponse.ok || !statusResult.data) throw new Error(statusResult.error?.message ?? 'Payment status could not be checked.')
        if (statusResult.data.status === 'succeeded') {
          const contactResponse = await fetch(`/api/v1/marketplace/payments/products/${encodeURIComponent(slug)}/contact`, { method: 'POST', headers: { 'X-Unlock-Token': accessToken } })
          const contactResult = await contactResponse.json() as { data?: { name: string; phone: string; whatsapp: string | null; email: string | null }; error?: { message?: string } }
          if (!contactResponse.ok || !contactResult.data) throw new Error(contactResult.error?.message ?? 'Verified contact could not be retrieved.')
          setContact(contactResult.data)
          setUnlockMessage('Payment verified. WhatsApp is ready.')
          setPaymentPanelOpen(false)
          return
        }
        if (['failed', 'cancelled', 'expired', 'reversed', 'refunded'].includes(statusResult.data.status)) {
          setUnlockMessage('Payment was not completed.')
          return
        }
      }
      setUnlockMessage('Payment is still being verified.')
    } catch (reason) {
      setUnlockMessage(reason instanceof Error ? reason.message : 'Contact unlock could not be completed.')
    } finally {
      setUnlocking(false)
    }
  }

  async function checkExistingUnlock() {
    const paymentReference = sessionStorage.getItem(`mh_unlock_payment_${slug}`)
    if (!unlockToken || !paymentReference) return
    setUnlocking(true)
    try {
      const response = await fetch(`/api/v1/marketplace/payments/${paymentReference}/status`, { headers: { 'X-Payment-Token': unlockToken } })
      const result = await response.json() as { data?: { status: string }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Payment status could not be checked.')
      if (result.data.status !== 'succeeded') {
        setUnlockMessage('Payment is still being verified.')
        return
      }
      const contactResponse = await fetch(`/api/v1/marketplace/payments/products/${encodeURIComponent(slug)}/contact`, { method: 'POST', headers: { 'X-Unlock-Token': unlockToken } })
      const contactResult = await contactResponse.json() as { data?: { name: string; phone: string; whatsapp: string | null; email: string | null }; error?: { message?: string } }
      if (!contactResponse.ok || !contactResult.data) throw new Error(contactResult.error?.message ?? 'Verified contact could not be retrieved.')
      setContact(contactResult.data)
      setUnlockMessage('Payment verified. WhatsApp is ready.')
      setPaymentPanelOpen(false)
    } catch (reason) {
      setUnlockMessage(reason instanceof Error ? reason.message : 'Payment status could not be checked.')
    } finally {
      setUnlocking(false)
    }
  }

  async function reportListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setReportMessage('')
    try {
      const response = await fetch(`/api/v1/marketplace/products/${encodeURIComponent(slug)}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: formData.get('reason'), details: formData.get('details'), email: formData.get('email') }),
      })
      const result = await response.json() as { data?: { reportReference: string }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'The report could not be sent.')
      setReportMessage('Thanks. The marketplace support team will review this listing.')
      setReportOpen(false)
    } catch (reason) {
      setReportMessage(reason instanceof Error ? reason.message : 'The report could not be sent.')
    }
  }

  const productHeader = <header>
    <Link className="market-brand" to="/marketplace"><span className="market-logo"><ShoppingBag size={26} /></span><span><strong>Market<span>hub</span></strong><small>Buy. Sell. Save More.</small></span></Link>
    <Link to="/">Platform home</Link>
  </header>
  if (loading) return <div className="product-page">{productHeader}<main><div className="catalogue-message">Loading listing…</div></main></div>
  if (!listing) return <div className="product-page">{productHeader}<main><div className="catalogue-message" role="alert">{error || 'This listing is unavailable.'}</div></main></div>

  return <div className="product-page">
    {productHeader}
    <main>
      <Link className="back-link" to="/marketplace">← Marketplace</Link>
      <div className="product-detail">
        <div className="product-gallery"><div className="product-detail-image">{listing.images[selectedImage] ? <img src={listing.images[selectedImage]} alt={`${listing.title}, image ${selectedImage + 1}`} /> : <span>No image provided</span>}</div>{listing.images.length > 1 && <div className="image-thumbnails" aria-label="Product images">{listing.images.map((image, index) => <button type="button" key={image} className={selectedImage === index ? 'active' : ''} aria-label={`View image ${index + 1}`} aria-pressed={selectedImage === index} onClick={() => setSelectedImage(index)}><img src={image} alt="" loading="lazy" /></button>)}</div>}</div>
        <section>
          <small>{listing.category} · {listing.town}, {listing.county}</small>
          <h1>{listing.title}</h1>
          <p className="detail-price">{formatKes(listing.priceKes)} {listing.negotiable && <span>Negotiable</span>}</p>
          <p>{listing.description}</p>
          <dl>
            <div><dt>Condition</dt><dd>{listing.condition.replaceAll('_', ' ')}</dd></div>
            <div><dt>Listing reference</dt><dd>{listing.reference}</dd></div>
            <div><dt>Published</dt><dd>{listing.publishedAt ? new Date(listing.publishedAt).toLocaleDateString('en-KE') : '—'}</dd></div>
          </dl>
          {contact !== null ? <aside className="contact-protection is-unlocked">
            <div>
              <strong>{contact.name}</strong>
              <p><Phone size={14} /> <a href={`tel:${contact.phone}`}>{contact.phone}</a></p>
              {(contact.whatsapp || contact.phone) && <a className="whatsapp-contact-button" href={`https://wa.me/${(contact.whatsapp || contact.phone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"><FaWhatsapp size={17} /> Proceed to WhatsApp</a>}
              {contact.email && <p><a href={`mailto:${contact.email}`}>{contact.email}</a></p>}
            </div>
          </aside> : <>
            <div className="contact-unlock-actions">
              <button className="whatsapp-contact-button" type="button" onClick={() => setPaymentPanelOpen(true)}><FaWhatsapp size={17} /> Proceed to WhatsApp</button>
              {unlockMessage && <p role="status">{unlockMessage}</p>}
              {unlockToken && <button className="check-unlock" type="button" onClick={() => { setPaymentPanelOpen(true); void checkExistingUnlock() }} disabled={unlocking}>Check payment status</button>}
            </div>
            {paymentPanelOpen && <div className="payment-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !unlocking) setPaymentPanelOpen(false) }}>
              <section className="payment-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-payment-title">
                <header><div><span className="seller-eyebrow">M-PESA CHECKOUT</span><h2 id="contact-payment-title">Continue to WhatsApp</h2></div><button className="payment-dialog-close" type="button" aria-label="Close payment" disabled={unlocking} onClick={() => setPaymentPanelOpen(false)}><X size={18} /></button></header>
                <p className="payment-dialog-amount">{formatKes(listing.contactUnlockFeeKes)} <span>one-time contact unlock</span></p>
                <form className="unlock-form" onSubmit={unlockSellerContact}>
                  <label>M-Pesa phone number<input required inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0712 345 678" /></label>
                  <label>Email for payment receipt<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                  <button className="pay-button" type="submit" disabled={unlocking}>{unlocking ? 'Waiting for verification…' : `Pay ${formatKes(listing.contactUnlockFeeKes)} with M-Pesa`}</button>
                  {unlockMessage && <p className="payment-message" role="status">{unlockMessage}</p>}
                </form>
              </section>
            </div>}
          </>}
          <button type="button" className="report-listing-toggle" onClick={() => setReportOpen((open) => !open)}>{reportOpen ? 'Cancel report' : 'Report this listing'}</button>
          {reportOpen && <form className="report-listing-form" onSubmit={reportListing}><label>Reason<select name="reason" required><option value="">Select a reason</option><option value="fraud">Suspected fraud</option><option value="prohibited">Prohibited item</option><option value="misleading">Misleading description</option><option value="duplicate">Duplicate listing</option><option value="other">Other concern</option></select></label><label>Details (optional)<textarea name="details" maxLength={1000} rows={3} /></label><label>Email for follow-up (optional)<input name="email" type="email" maxLength={254} /></label><button type="submit">Send report</button></form>}
          {reportMessage && <p className="report-message" role="status">{reportMessage}</p>}
        </section>
      </div>
    </main>
  </div>
}

function LandingPage() {
  const [footerSocial, setFooterSocial] = useState<FooterSocialLinks>({ facebookUrl: null, xUrl: null, youtubeUrl: null, whatsappUrl: null })
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/marketplace/settings/footer-social-links', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return
        const result = await response.json() as { data?: FooterSocialLinks }
        if (result.data) setFooterSocial(result.data)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])
  return <div className="platform-shell landing-shell">
    <header className="platform-header">
      <Link to="/" className="brand-lockup" aria-label="MarketHub home">
        <span className="brand-bag"><ShoppingBag size={30} strokeWidth={2.6} /></span>
        <span><strong>Market<span>Hub</span></strong><small>Shop. Discover. More.</small></span>
      </Link>
      <nav className="landing-nav" aria-label="Main navigation">
        <a className="nav-current" href="#home"><House size={15} />Home</a>
        <a href="#about"><CircleHelp size={15} />About</a>
        <a href="mailto:hello@markethub.co.ke"><Compass size={15} />Contact</a>
        <Link className="nav-cta" to="/marketplace">Get Started <ArrowRight size={15} /></Link>
      </nav>
    </header>

    <main id="home" className="landing-main">
      <div className="landscape-backdrop" aria-hidden="true" />
      <section className="landing-intro" aria-labelledby="landing-title">
        <p className="intro-kicker">YOUR NEXT GREAT FIND STARTS HERE</p>
        <h1 id="landing-title">Everything You Need.<br /><span>One Destination.</span></h1>
        <p className="landing-subtitle"><i />Choose your shopping experience and explore more possibilities.<i /></p>
      </section>

      <section className="destination-grid" aria-label="Choose a website">
        <article className="destination-card kits-card">
          <img src="/images/the%20kits.png" alt="Football shirts in a stadium under match lights" />
          <div className="card-shade" />
          <div className="destination-content">
            <span className="destination-tag"><span className="football-mark">●</span> Football Kits</span>
            <h2>Selling<br /><em>Kits</em></h2>
            <p>Discover football jerseys, club collections and your favourite kits.</p>
            <a className="destination-button orange-button" href="/kits">
              Explore Selling Kits <ArrowRight size={17} />
            </a>
          </div>
          <span className="card-index">01 / 02</span>
        </article>

        <article className="destination-card market-card">
          <img src="/images/second%20hand.png" alt="A collection of second-hand products for sale" />
          <div className="card-shade" />
          <div className="destination-content">
            <span className="destination-tag"><ShoppingBag size={14} /> Second-Hand</span>
            <h2>Second-Hand<br /><em>Marketplace</em></h2>
            <p>Discover, advertise and connect with buyers and sellers of pre-loved finds.</p>
            <Link className="destination-button green-button" to="/marketplace">
              Explore Marketplace <ArrowRight size={17} />
            </Link>
          </div>
          <span className="card-index">02 / 02</span>
        </article>
      </section>

      <section className="trust-strip" aria-label="Marketplace values">
        <div><ShieldCheck /><span><strong>Secure &amp; Trusted</strong><small>Shop with confidence</small></span></div>
        <div><Zap /><span><strong>Fast &amp; Easy</strong><small>Find what you need</small></span></div>
        <div><MapPin /><span><strong>Local Focus</strong><small>Machakos and beyond</small></span></div>
        <div><BadgeCheck /><span><strong>Connect Directly</strong><small>Buy and sell with ease</small></span></div>
      </section>
    </main>

    <footer id="about" className="landing-footer">
      <Link to="/" className="footer-brand"><span className="brand-bag"><ShoppingBag size={28} /></span><span><strong>Market<span>Hub</span></strong><small>Shop. Discover. More.</small></span></Link>
      <p><i />Two Amazing Shopping Experiences.<br />One Powerful Platform.<i /></p>
      <div className="footer-right">
        <div className="footer-social" role="group" aria-label="MarketHub social networks">
          {footerSocial.facebookUrl ? <a className="social-facebook" href={footerSocial.facebookUrl} target="_blank" rel="noreferrer" aria-label="MarketHub on Facebook"><FaFacebookF /></a> : <span className="social-facebook" role="img" aria-label="Facebook link not configured"><FaFacebookF /></span>}
          {footerSocial.xUrl ? <a className="social-x" href={footerSocial.xUrl} target="_blank" rel="noreferrer" aria-label="MarketHub on X"><FaXTwitter /></a> : <span className="social-x" role="img" aria-label="X link not configured"><FaXTwitter /></span>}
          {footerSocial.youtubeUrl ? <a className="social-youtube" href={footerSocial.youtubeUrl} target="_blank" rel="noreferrer" aria-label="MarketHub on YouTube"><FaYoutube /></a> : <span className="social-youtube" role="img" aria-label="YouTube link not configured"><FaYoutube /></span>}
          {footerSocial.whatsappUrl ? <a className="social-whatsapp" href={footerSocial.whatsappUrl} target="_blank" rel="noreferrer" aria-label="Message MarketHub on WhatsApp"><FaWhatsapp /></a> : <span className="social-whatsapp" role="img" aria-label="Kenyan WhatsApp number not configured"><FaWhatsapp /></span>}
        </div>
        <span className="footer-divider" aria-hidden="true" />
        <div className="footer-meta"><span className="kenya-flag" role="img" aria-label="Flag of Kenya"><span className="kenya-shield" /></span><span>Kenya</span></div>
      </div>
    </footer>
  </div>
}

function MarketplaceHome() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('q') ?? ''
  const category = searchParams.get('category') ?? ''
  const requestedPage = Number(searchParams.get('page') ?? '1')
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const [categories, setCategories] = useState<MarketplaceCategory[]>([])
  const [counties, setCounties] = useState<MarketplaceCounty[]>([])
  const [categoryError, setCategoryError] = useState('')
  const [categoryRetry, setCategoryRetry] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [searchText, setSearchText] = useState(search)
  const filters: CatalogueFilters = {
    county: searchParams.get('county') ?? '',
    subcounty: searchParams.get('subcounty') ?? '',
    town: searchParams.get('town') ?? '',
    condition: searchParams.get('condition') ?? '',
    minPrice: searchParams.get('minPrice') ?? '',
    maxPrice: searchParams.get('maxPrice') ?? '',
    publishedAfter: searchParams.get('publishedAfter') ?? '',
    publishedBefore: searchParams.get('publishedBefore') ?? '',
    negotiable: searchParams.get('negotiable') ?? '',
    sort: searchParams.get('sort') ?? 'newest',
    featured: searchParams.get('featured') ?? (search || category ? 'all' : 'true'),
  }
  const filterQuery = new URLSearchParams(Object.entries(filters).filter(([key, value]) => value !== '' && (value !== 'false' || key === 'featured'))).toString()
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/marketplace/categories', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { data?: MarketplaceCategory[]; error?: { message?: string } }
        if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Categories could not be loaded.')
        setCategories(result.data)
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setCategoryError(reason instanceof Error ? reason.message : 'Categories could not be loaded.') })
    return () => controller.abort()
  }, [categoryRetry])
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/marketplace/locations/counties', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { data?: MarketplaceCounty[] }
        if (response.ok && result.data) setCounties(result.data)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])
  const setQuery = (values: Record<string, string>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    next.delete('page')
    setSearchParams(next)
  }
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setQuery({ q: searchText.trim() })
  }
  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const values = Object.fromEntries(['county', 'subcounty', 'town', 'condition', 'minPrice', 'maxPrice', 'publishedAfter', 'publishedBefore', 'negotiable', 'sort'].map((key) => [key, String(formData.get(key) ?? '')]))
    values.featured = formData.has('featuredOnly') ? 'true' : searchParams.get('featured') === 'false' ? 'false' : 'all'
    setQuery(values)
  }
  return <div className="marketplace-shell">
    <header className="marketplace-header">
      <Link to="/" className="market-brand"><span className="market-logo"><ShoppingBag size={26} /></span><span><strong>Market<span>hub</span></strong><small>Buy. Sell. Save More.</small></span></Link>
      <nav aria-label="Marketplace navigation"><Link className="market-home" to="/marketplace"><House size={15} />Home</Link><a href="#categories">Categories⌄</a><a href="#locations">Locations⌄</a><a href="#how-it-works">How It Works</a><a href="mailto:hello@markethub.co.ke">Contact</a></nav>
      <div className="market-actions"><Link className="sell-link" to="/marketplace/seller/login">+ <span>Sell item</span></Link><Link className="market-login" to="/admin/marketplace/login">Admin</Link></div>
    </header>
    <main>
      <section className="market-hero">
        <div className="market-hero-photo" aria-hidden="true" />
        <div className="market-hero-copy">
          <span className="hero-eyebrow"><Sparkles size={14} /> MACHAKOS FINDS, BETTER DAYS</span>
          <h1>Second-Hand<br /><em>Marketplace</em></h1>
          <p>Discover, advertise and connect with buyers and sellers of quality second-hand products.</p>
          <form className="market-search" onSubmit={submitSearch}><label className="sr-only" htmlFor="market-search-input">Search products</label><Search size={18} /><input id="market-search-input" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search for products..." /><button type="submit">Search</button></form>
          <p className="popular-searches"><strong>🔥 Popular:</strong>{categories.filter((item) => ['phones-and-accessories', 'computers-and-laptops', 'furniture', 'vehicles'].includes(item.slug)).map((item) => <Link key={item.id} to={`/marketplace?category=${item.slug}`}>{item.name.split(' ')[0]}</Link>)}</p>
        </div>
        <div className="hero-burst">Great<br />Deals!</div>
      </section>
      <section id="categories" className="category-rail" aria-label="Browse categories">
        {categories.length ? <>{categories.slice(0, 10).map((item) => <Link key={item.id} to={`/marketplace?category=${encodeURIComponent(item.slug)}`} aria-current={category === item.slug ? 'page' : undefined}><span>{categoryIcons[item.slug] ?? '◈'}</span><small>{item.name}</small></Link>)}<a href="#categories"><span>••</span><small>More Categories</small></a></> : <p className="category-state">{categoryError ? <>Categories unavailable. <button type="button" onClick={() => setCategoryRetry((value) => value + 1)}>Retry</button></> : 'Loading categories…'}</p>}
      </section>
      <section className="market-content">
        <div className="listing-area">
          <div className="section-title"><span /> <h2>{search ? 'Search Results' : filters.featured === 'false' ? 'Recently Published' : filters.featured === 'true' ? 'Featured Listings' : 'All Listings'}</h2></div>
          <div className="listing-tabs" role="group" aria-label="Listing collection"><button type="button" aria-pressed={filters.featured === 'all'} onClick={() => setQuery({ featured: 'all' })}>All</button><button type="button" aria-pressed={filters.featured === 'true'} onClick={() => setQuery({ featured: 'true' })}>Featured</button><button type="button" aria-pressed={filters.featured === 'false'} onClick={() => setQuery({ featured: 'false' })}>Recently Published</button></div>
          <div className="listing-tools"><button type="button" className={filtersOpen ? 'filter-button is-open' : 'filter-button'} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal size={14} /> Filters</button><span>{counties.length ? `${counties.length} counties` : 'Kenya'}</span><div className="view-toggle" role="group" aria-label="Listing view"><button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={15} /></button><button type="button" aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><ListIcon size={15} /></button></div></div>
          <form className={`filter-panel${filtersOpen ? ' is-open' : ''}`} onSubmit={submitFilters}>
            <label>County<select name="county" defaultValue={filters.county}><option value="">All counties</option>{counties.map((county) => <option value={county.name} key={county.code}>{county.name}</option>)}</select></label>
            <label>Subcounty<input name="subcounty" defaultValue={filters.subcounty} /></label>
            <label>Town<input name="town" defaultValue={filters.town} /></label>
            <label>Condition<select name="condition" defaultValue={filters.condition}><option value="">Any condition</option><option value="new">New</option><option value="like_new">Like new</option><option value="good">Good</option><option value="fair">Fair</option><option value="used">Used</option></select></label>
            <label>Min KSh<input name="minPrice" type="number" min="0" step="1" defaultValue={filters.minPrice} /></label>
            <label>Max KSh<input name="maxPrice" type="number" min="0" step="1" defaultValue={filters.maxPrice} /></label>
            <label>Published after<input name="publishedAfter" type="date" defaultValue={filters.publishedAfter} /></label>
            <label>Published before<input name="publishedBefore" type="date" defaultValue={filters.publishedBefore} /></label>
            <label>Sort<select name="sort" defaultValue={filters.sort}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="price_low">Lowest price</option><option value="price_high">Highest price</option><option value="updated">Recently updated</option></select></label>
            <label className="filter-check"><input name="negotiable" type="checkbox" value="true" defaultChecked={filters.negotiable === 'true'} /> Negotiable</label>
            <label className="filter-check"><input name="featuredOnly" type="checkbox" value="true" defaultChecked={filters.featured === 'true'} /> Featured only</label>
            <button type="submit">Apply filters</button><button type="button" className="filter-reset" onClick={() => setQuery({ county: '', subcounty: '', town: '', condition: '', minPrice: '', maxPrice: '', publishedAfter: '', publishedBefore: '', negotiable: '', sort: '', featured: '' })}>Reset</button>
          </form>
          <ProductResults search={search} category={category} filterQuery={filterQuery} page={page} view={view} onPageChange={(nextPage) => setQuery({ page: String(nextPage) })} />
        </div>
        <aside id="how-it-works" className="how-panel"><h2>How It Works?</h2><ol><li><b>1</b><span><strong>Browse Products</strong><small>Search and find what you need.</small></span></li><li><b>2</b><span><strong>Unlock Contact</strong><small>Pay a small fee to access seller details.</small></span></li><li><b>3</b><span><strong>Connect</strong><small>Get in touch with the seller and close the deal.</small></span></li></ol><Link to="/marketplace/sell">Start Selling <ArrowRight size={15} /></Link></aside>
      </section>
      <section id="locations" className="market-trust"><span><ShieldCheck /><b>Secure &amp; Trusted</b><small>Your safety comes first</small></span><span><Zap /><b>Fast &amp; Easy</b><small>List or find items quickly</small></span><span><MapPin /><b>Across Kenya</b><small>From Machakos to all counties</small></span><span><BadgeCheck /><b>Direct Connections</b><small>Connect with confidence</small></span></section>
    </main>
    <footer className="market-footer"><Link to="/">MarketHub</Link><span><a href="#privacy">Privacy</a><a href="#terms">Terms</a><a href="mailto:hello@markethub.co.ke">Contact</a></span><small>© {new Date().getFullYear()} MarketHub Kenya</small></footer>
  </div>
}

function KitsRedirect() {
  useEffect(() => { window.location.replace(kitzOrigin) }, [])
  return <p className="redirect-message">Opening Selling Kits…</p>
}

export function App() {
  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/kits/*" element={<KitsRedirect />} />
    <Route path="/marketplace" element={<MarketplaceHome />} />
    <Route path="/marketplace/sell" element={<SellListingPage />} />
    <Route path="/marketplace/seller/signup" element={<SellerSignupPage />} />
    <Route path="/marketplace/seller/login" element={<SellerLoginPage />} />
    <Route path="/marketplace/seller/forgot-password" element={<SellerForgotPasswordPage />} />
    <Route path="/marketplace/seller/reset-password" element={<SellerResetPasswordPage />} />
    <Route path="/marketplace/seller/verify" element={<SellerVerifyPage />} />
    <Route path="/marketplace/seller" element={<SellerPortalPage />} />
    <Route path="/marketplace/status" element={<SubmissionStatusPage />} />
    <Route path="/marketplace/products/:slug" element={<MarketplaceProductPage />} />
    <Route path="/admin/marketplace/login" element={<MarketplaceAdminPage />} />
    <Route path="/admin/marketplace/activate" element={<MarketplaceAdminPage />} />
    <Route path="/admin/marketplace/verify" element={<MarketplaceAdminPage />} />
    <Route path="/admin/marketplace/dashboard" element={<MarketplaceAdminPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}