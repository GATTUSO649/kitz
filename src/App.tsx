import { Fragment, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowRight, Check, ChevronDown, Heart, MapPin, Menu, Search, ShieldCheck, ShoppingBag, ShoppingCart, Smartphone, Star, Truck, UserRound, X } from 'lucide-react'
import { z } from 'zod'
import './App.css'
import './checkout.css'
import './brand.css'
import './pages.css'
import './theme.css'
import './homepage.css'
import './public-theme.css'
import './admin-theme.css'
import './customer-portal-theme.css'
import { AdminRoute } from './pages/AdminPages'
import { MarketplacePage, ProductCategoryLine, ProductPage, ShopPage, type BuyNowCheckoutDetails, type ShopProduct, type ShopPurchaseSelection, type ShopVariant } from './pages/ShopPages'
import { CustomerChatPage, CustomerPortalOverview, CustomerPortalOrdersPage, CustomerPortalPage } from './pages/CustomerPortalPages'
import { GoogleMapView } from './components/GoogleMapView'
import { CustomerPortalLayout } from './layouts/CustomerPortalLayout'
import { AuthLayout } from './layouts/AuthLayout'
import { CustomerAuthForm, CustomerAuthInfoPage } from './pages/AuthPages'

const cultureLogo = '/culture-mark.png'
type Variant = { id: number; size: string; stock: number; price?: string | null }
type Product = {
  id: number
  name: string
  slug: string
  description: string
  price: string
  salePrice?: string | null
  imageUrl: string | null
  ratingAverage?: number
  reviewCount?: number
  featured: boolean
  trending?: boolean
  category: { name: string } | null
  team?: { id: number; name: string; slug: string } | null
  league?: { id: number; name: string; slug: string; country: string } | null
  jerseyCategory?: { id: number; name: string; slug: string } | null
  images?: { imageUrl: string; isPrimary: boolean; sortOrder: number }[]
  variants: Variant[]
}
type HomepageSlide = {
  id: number
  imageUrl: string
  displayDurationSeconds: number
  title: string
  subtitle: string
  promotionalMessage: string | null
  ctaLabel: string
  destinationUrl: string
}
type HomepageTeam = { id: number; name: string; slug: string; productCount: number }
type HomepageLeague = { id: number; name: string; slug: string; country: string; countryCode: string; season: string; teams: (HomepageTeam & { leagueId: number; sortOrder: number })[] }
type HomepageData = { slides: HomepageSlide[]; leagues: HomepageLeague[] }
type CartLine = { productId: number; variantId?: number; name: string; price: number; imageUrl: string | null; size: string; stock: number; quantity: number }
type AccountUser = { id: number; email: string; fullName: string; phone: string | null }
type AccountSummary = { orderCount: number; savedAddressCount: number; wishlistCount: number }
type DeliveryZone = { id: number; name: string; fee: string }
type MpesaPaymentOptions = { mpesaTillName: string; mpesaTillNumber: string; mpesaMobileNumber: string; mpesaTransactionType: string; stkPushAvailable: boolean }
type CustomerOrder = { orderNumber: string; status: string; paymentMethod: 'pay_on_delivery' | 'mpesa'; currency: string; total: string; createdAt: string }

const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 })
const categories = ['All kits', 'Club kits', 'National teams', 'Retro', 'Training']
const homepageTrendingClubBadges: Record<string, number> = {
  arsenal: 57,
  liverpool: 64,
  'manchester-city': 65,
  'manchester-united': 66,
  chelsea: 61,
  'tottenham-hotspur': 73,
  'real-madrid': 86,
  barcelona: 81,
  'atletico-madrid': 78,
  'bayern-munich': 5,
  'borussia-dortmund': 4,
  'bayer-leverkusen': 3,
  'rb-leipzig': 721,
  'paris-saint-germain': 524,
  marseille: 516,
  inter: 108,
  juventus: 109,
  milan: 98,
  napoli: 113,
  roma: 100,
}
const homepageTrendingClubOrder = new Map(Object.keys(homepageTrendingClubBadges).map((slug, index) => [slug, index]))
const registrationSchema = z.object({ fullName: z.string().trim().min(2, 'Enter your name.'), email: z.string().trim().email('Enter a valid email address.'), password: z.string().min(12, 'Use at least 12 characters.').refine((value) => new TextEncoder().encode(value).length <= 72, 'Use a password no longer than 72 UTF-8 bytes.'), passwordConfirmation: z.string().min(1, 'Confirm your password.') }).refine((values) => values.password === values.passwordConfirmation, { message: 'Passwords do not match.', path: ['passwordConfirmation'] })
const signInSchema = z.object({ email: z.string().trim().email('Enter a valid email address.'), password: z.string().min(1, 'Enter your password.') })

async function loadHomepageProducts(path: string) {
  const response = await fetch(path)
  const result = await response.json() as { data?: Product[]; error?: { message?: string } }
  if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Products could not be loaded.')
  return result.data
}

async function loadAllCatalogProducts() {
  const products: Product[] = []
  let page = 1
  while (true) {
    const response = await fetch(`/api/v1/products?limit=60&page=${page}`)
    const result = await response.json() as { data?: Product[]; pagination?: { hasMore: boolean }; error?: { message?: string } }
    if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Products could not be loaded.')
    products.push(...result.data)
    if (!result.pagination?.hasMore) return products
    page += 1
  }
}

function ProductRating({ rating = 0, count = 0 }: { rating?: number; count?: number }) {
  return <div className="product-rating" aria-label={count ? `${rating.toFixed(1)} out of 5 from ${count} reviews` : 'No customer reviews yet'}>
    <span className="product-rating-stars" aria-hidden="true">{[1, 2, 3, 4, 5].map((star) => <Star key={star} size={13} fill={star <= Math.round(rating) ? 'currentColor' : 'none'} />)}</span>
    <span>{count ? `${rating.toFixed(1)} (${count})` : 'No reviews'}</span>
  </div>
}

function CheckoutPaymentOptions({ paymentMethod, onPaymentMethodChange, mpesaOptions, accountUser, payerPhone, onPayerPhoneChange }: { paymentMethod: 'pay_on_delivery' | 'mpesa'; onPaymentMethodChange: (method: 'pay_on_delivery' | 'mpesa') => void; mpesaOptions?: MpesaPaymentOptions; accountUser: AccountUser | null; payerPhone: string; onPayerPhoneChange: (phone: string) => void }) {
  const mpesaReady = Boolean(mpesaOptions?.stkPushAvailable)
  return <fieldset className="checkout-payment-options">
    <legend>Payment method</legend>
    <label className="checkout-payment-option"><input type="radio" name="paymentMethod" value="pay_on_delivery" checked={paymentMethod === 'pay_on_delivery'} onChange={() => onPaymentMethodChange('pay_on_delivery')} /><span><strong>Pay on Delivery</strong><small>Pay when your kit is delivered.</small></span></label>
    <label className="checkout-payment-option"><input type="radio" name="paymentMethod" value="mpesa" checked={paymentMethod === 'mpesa'} disabled={!mpesaReady} onChange={() => onPaymentMethodChange('mpesa')} /><span><strong>M-PESA Express (STK Push)</strong><small>{mpesaReady ? 'Approve the payment prompt on your chosen Kenyan number.' : 'Temporarily unavailable.'}</small></span></label>
    {paymentMethod === 'mpesa' ? <div className="checkout-mpesa-panel">
      <div className="checkout-mpesa-merchant"><Smartphone size={19} /><span><strong>{mpesaOptions?.mpesaTillName || 'KitCulture'}</strong><small>{mpesaOptions?.mpesaTransactionType === 'CustomerPayBillOnline' ? 'PayBill' : 'Buy Goods Till'}</small></span></div>
      <dl><div><dt>{mpesaOptions?.mpesaTransactionType === 'CustomerPayBillOnline' ? 'PayBill number' : 'Till number'}</dt><dd>{mpesaOptions?.mpesaTillNumber || 'Not configured yet'}</dd></div></dl>
      {mpesaOptions?.mpesaMobileNumber && <dl><div><dt>Manual payment to mobile</dt><dd>{mpesaOptions.mpesaMobileNumber}</dd></div></dl>}
      <label>M-PESA phone number<input type="tel" inputMode="tel" autoComplete="tel" required pattern="(?:0[17][0-9]{8}|\\+?254[17][0-9]{8})" title="Enter a valid Kenyan number, such as 0712345678 or +254712345678." maxLength={13} placeholder="0712345678 or +254712345678" value={payerPhone} onChange={(event) => onPayerPhoneChange(event.target.value)} /></label>
      <dl><div><dt>Paying customer</dt><dd>{accountUser?.fullName || 'Signed-in customer'}</dd></div><div><dt>Prompt destination</dt><dd>{payerPhone || 'Enter a Kenyan phone number'}</dd></div></dl>
      <p className="checkout-mpesa-notice">The prompt is sent to this number. Enter your PIN only on your phone; KitCulture never asks for or receives your M-PESA PIN.</p>
    </div> : <p>A delivery location pin is required before placing the order.</p>}
  </fieldset>
}

function HomepageProductSection({ title, kicker, products, error, onAdd, onSave, portalMode = false, showAll = false, showBuyButton = false, id, categoryImageUrl, shopAllHref, shopAllLabel }: {
  title: string
  kicker: string
  products: Product[]
  error?: string
  onAdd: (product: Product) => void
  onSave: (productId: number) => void
  portalMode?: boolean
  showAll?: boolean
  showBuyButton?: boolean
  id?: string
  categoryImageUrl?: string | null
  shopAllHref?: string
  shopAllLabel?: string
}) {
  const productPath = (slug: string) => portalMode ? `/account/marketplace/products/${slug}` : `/products/${slug}`
  const marketplacePath = portalMode ? '/account/marketplace' : '/shop'
  const isCategoryGroup = categoryImageUrl !== undefined
  const sectionClass = `home-product-section page-width${portalMode ? ' portal-featured-kits' : ''}${isCategoryGroup ? ' home-category-group' : ''}`
  if (error) return <section className={sectionClass}><div className="catalogue-state error-state"><strong>{title} are unavailable.</strong><span>{error}</span></div></section>
  if (!products.length) return null
  return <section id={id} className={sectionClass}>
    <div className="section-heading"><div className={isCategoryGroup ? 'homepage-category-heading' : undefined}>{categoryImageUrl && <span className="homepage-category-image"><img src={categoryImageUrl} alt="" loading="lazy" /></span>}<div><div className="eyebrow"><span className="eyebrow-line" />{kicker}</div><h2>{title}</h2></div></div><Link className="text-link" to={shopAllHref ?? marketplacePath}>{shopAllLabel ?? (isCategoryGroup ? 'View category' : 'Shop all')} <ArrowRight size={15} /></Link></div>
    <div className="product-grid">{(showAll ? products : products.slice(0, 4)).map((product) => {
      const inStock = product.variants.some((variant) => variant.stock > 0)
      return <article className="product-card" key={product.id}>
        <div className="product-media"><Link className="shop-product-link" to={productPath(product.slug)} aria-label={`View ${product.name}`}>{product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy" /> : <div className="product-image-empty"><span>KC</span><small>IMAGE TO BE ADDED</small></div>}</Link>
          {(product.salePrice || product.trending) && <span className={`product-tag${product.salePrice ? ' product-tag-sale' : ''}`}>{product.salePrice ? 'SALE' : 'TRENDING'}</span>}
          <button className="product-favourite" type="button" aria-label={`Save ${product.name} to your wishlist`} onClick={() => onSave(product.id)}><Heart size={14} /></button>
        </div>
        <div className={`product-info${portalMode ? ' portal-kit-info' : ''}`}><div><ProductCategoryLine team={product.team?.name} league={product.league?.name} jerseyCategory={product.jerseyCategory?.name} category={portalMode ? undefined : product.category?.name} fallback="KitCulture" /><h3><Link to={productPath(product.slug)}>{product.name}</Link></h3></div><span className="product-price">{product.salePrice ? <><del>{money.format(Number(product.price))}</del><strong className="sale-price">{money.format(Number(product.salePrice))}</strong></> : money.format(Number(product.price))}</span>{portalMode && <ProductRating rating={product.ratingAverage} count={product.reviewCount} />}</div>
        {!portalMode && <ProductRating rating={product.ratingAverage} count={product.reviewCount} />}
        <div className="product-meta"><div className="product-sizes">{product.variants.length ? product.variants.map((variant) => <span className={!variant.stock ? 'is-sold-out' : ''} key={variant.id}>{variant.size}</span>) : <span>Unavailable</span>}</div><span className={inStock ? 'stock-label' : 'stock-label sold-out'}>{inStock ? 'In stock' : 'Out of stock'}</span></div>
        {inStock ? <div className={showBuyButton ? 'product-card-actions' : undefined}><button className="quick-add" type="button" onClick={() => onAdd(product)}><ShoppingCart size={13} />Add to Cart</button>{showBuyButton && <Link className="product-card-buy" to={productPath(product.slug)}>Buy <ArrowRight size={14} /></Link>}</div> : <Link className="quick-add quick-add-preview" to={productPath(product.slug)}><ShoppingCart size={13} />View kit</Link>}
      </article>
    })}</div>
  </section>
}

function CustomerDashboardKits({ products, error, onAdd, onSave }: {
  products: Product[]
  error?: string
  onAdd: (product: Product) => void
  onSave: (productId: number) => void
}) {
  if (error) return <section className="portal-dashboard-kits"><div className="catalogue-state error-state"><strong>Kits are unavailable.</strong><span>{error}</span></div></section>
  if (!products.length) return <section className="portal-dashboard-kits"><div className="catalogue-state"><strong>No kits are listed yet.</strong><span>New collections will appear here when they are available.</span><Link className="button button-green" to="/account/marketplace">Browse marketplace <ArrowRight size={15} /></Link></div></section>

  const categories = new Map<string, Product[]>()
  for (const product of products) {
    const category = product.category?.name ?? 'Other kits'
    const categoryProducts = categories.get(category) ?? []
    categoryProducts.push(product)
    categories.set(category, categoryProducts)
  }

  return <div className="portal-dashboard-kits">{[...categories.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([category, categoryProducts]) => <HomepageProductSection
    key={category}
    title={category}
    kicker="KIT COLLECTION"
    products={categoryProducts}
    onAdd={onAdd}
    onSave={onSave}
    portalMode
    showAll
    showBuyButton
  />)}</div>
}

function safeCustomerReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  try {
    const target = new URL(value, window.location.origin)
    if (target.origin !== window.location.origin || target.pathname.startsWith('/admin')
      || ['/login', '/signup', '/forgot-password', '/reset-password', '/verify-email'].includes(target.pathname)) return null
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return null
  }
}

function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const pagePath = location.pathname
  const isAdminPage = pagePath.startsWith('/admin')
  const isHomePage = pagePath === '/'
  const isShopPage = pagePath === '/shop' || pagePath === '/new-arrivals' || pagePath.startsWith('/categories/')
  const isMarketplacePage = pagePath === '/marketplace' || /^\/marketplace\/teams\/[^/]+\/[^/]+$/.test(pagePath)
  const isProductPage = pagePath.startsWith('/products/')
  const isLoginPage = pagePath === '/login' || pagePath === '/signup'
  const isCustomerAuthRoute = isLoginPage || ['/forgot-password', '/reset-password', '/verify-email'].includes(pagePath)
  const isCartPage = pagePath === '/cart'
  const isAccountCheckoutRoute = pagePath === '/account/checkout'
  const isCheckoutPage = pagePath === '/checkout' || isAccountCheckoutRoute
  const isOrdersPage = pagePath === '/account/orders'
  const isAccountPage = pagePath === '/account'
  const isAccountSubpage = /^\/account\/(profile|security|addresses|wishlist|notifications|chat|support|settings)$/.test(pagePath)
    || /^\/account\/(orders|track-order)\/[^/]+$/.test(pagePath)
  const isAccountCartRoute = pagePath === '/account/cart'
  const isAccountPortalRoute = pagePath.startsWith('/account')
  const isPortalMarketplaceProduct = /^\/account\/marketplace\/products\/[^/]+$/.test(pagePath)
  const isPortalMarketplaceTeam = /^\/account\/marketplace\/teams\/[^/]+\/[^/]+$/.test(pagePath)
  const isPortalMarketplaceRoute = pagePath === '/account/marketplace' || isPortalMarketplaceProduct || isPortalMarketplaceTeam
  const isPortalPath = isAccountPage || pagePath === '/account/dashboard' || isOrdersPage || isAccountSubpage || isAccountCartRoute || isAccountCheckoutRoute || isPortalMarketplaceRoute
  const isNotFoundPage = !isAdminPage && !isHomePage && !isShopPage && !isMarketplacePage && !isProductPage && !isCustomerAuthRoute && !isCartPage && !isCheckoutPage && !isAccountPortalRoute
  const [cart, setCart] = useState<CartLine[]>(() => {
    try { return JSON.parse(localStorage.getItem('kitculture-cart') ?? '[]') as CartLine[] } catch { return [] }
  })
  const [buyNowItems, setBuyNowItems] = useState<CartLine[] | null>(null)
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('All kits')
  const [activeSlideIndex, setActiveSlideIndex] = useState(0)
  const [showAllTrendingTeams, setShowAllTrendingTeams] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [checkoutPinStatus, setCheckoutPinStatus] = useState('')
  const [checkoutLocation, setCheckoutLocation] = useState<{ latitude: number; longitude: number; accuracy: number | null } | null>(null)
  const [checkoutLatitude, setCheckoutLatitude] = useState('')
  const [checkoutLongitude, setCheckoutLongitude] = useState('')
  const [checkoutAccuracy, setCheckoutAccuracy] = useState<number | null>(null)
  const [checkoutPaymentMethod, setCheckoutPaymentMethod] = useState<'pay_on_delivery' | 'mpesa'>('pay_on_delivery')
  const [mpesaPhone, setMpesaPhone] = useState('')
  const [checkoutIdempotencyKey, setCheckoutIdempotencyKey] = useState('')
  const [checkoutDeliveryZoneId, setCheckoutDeliveryZoneId] = useState('')
  const [orderActionBusy, setOrderActionBusy] = useState('')
  const [orderActionError, setOrderActionError] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [accountUser, setAccountUser] = useState<AccountUser | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authFieldErrors, setAuthFieldErrors] = useState<Partial<Record<'fullName' | 'email' | 'password' | 'passwordConfirmation', string>>>({})
  const [authBusy, setAuthBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [introVisible, setIntroVisible] = useState(() => {
    if (typeof window === 'undefined') return false
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    return !reduced && !sessionStorage.getItem('kitculture-intro-seen')
  })
  const activeAuthMode = pagePath === '/signup' ? 'register' : 'login'

  const { data: products = [], isPending: loading, isError: catalogueError } = useQuery({
    queryKey: ['products'],
    enabled: isHomePage,
    queryFn: async () => {
      const response = await fetch('/api/v1/products')
      if (!response.ok) throw new Error('Catalogue unavailable')
      const result = await response.json() as { data: Product[] }
      return result.data
    },
  })
  const homepageQuery = useQuery({
    queryKey: ['store-homepage'],
    enabled: isHomePage,
    queryFn: async () => {
      const response = await fetch('/api/v1/store/homepage')
      const result = await response.json() as { data?: HomepageData; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Homepage content is unavailable.')
      return result.data
    },
  })
  const heroProductsQuery = useQuery({
    queryKey: ['products', 'homepage-hero'],
    enabled: isHomePage,
    queryFn: () => loadHomepageProducts('/api/v1/products/new-arrivals?limit=60'),
  })
  const trendingQuery = useQuery({
    queryKey: ['products', 'trending'],
    enabled: isHomePage,
    queryFn: () => loadHomepageProducts('/api/v1/products/trending?limit=4'),
  })
  const newArrivalsQuery = useQuery({
    queryKey: ['products', 'new-arrivals'],
    enabled: isHomePage,
    queryFn: () => loadHomepageProducts('/api/v1/products/new-arrivals?limit=6'),
  })
  const portalDashboardKitsQuery = useQuery({
    queryKey: ['portal-dashboard-kits'],
    enabled: (pagePath === '/account' || pagePath === '/account/dashboard') && Boolean(accountUser),
    queryFn: loadAllCatalogProducts,
  })
  const homepageSlides = homepageQuery.data?.slides ?? []
  const heroProducts = (heroProductsQuery.data ?? []).flatMap((product) => {
    const imageUrl = product.imageUrl ?? product.images?.find((image) => image.isPrimary)?.imageUrl ?? product.images?.[0]?.imageUrl
    return imageUrl ? [{ ...product, imageUrl }] : []
  })
  const activeSlide = homepageSlides.length ? homepageSlides[activeSlideIndex % homepageSlides.length] : undefined
  const activeHeroProduct = !activeSlide && heroProducts.length ? heroProducts[activeSlideIndex % heroProducts.length] : undefined
  const heroSlideCount = activeSlide ? homepageSlides.length : heroProducts.length
  useEffect(() => {
    if (heroSlideCount < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const interval = window.setInterval(() => {
      setActiveSlideIndex((index) => (index + 1) % heroSlideCount)
    }, activeHeroProduct ? 5000 : Math.max(2, activeSlide?.displayDurationSeconds ?? 5) * 1000)
    return () => window.clearInterval(interval)
  }, [activeHeroProduct, activeSlide?.displayDurationSeconds, activeSlideIndex, heroSlideCount])
  const { data: deliveryZones = [], isPending: zonesLoading, isError: zonesFailed, error: zonesError } = useQuery({
    queryKey: ['delivery-zones'],
    enabled: checkoutOpen || isCheckoutPage,
    queryFn: async () => {
      const response = await fetch('/api/v1/delivery/zones')
      const result = await response.json() as { data?: DeliveryZone[]; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Delivery areas are unavailable.')
      return result.data
    },
  })
  const { data: mpesaPaymentOptions } = useQuery({
    queryKey: ['mpesa-payment-options'],
    enabled: checkoutOpen || isCheckoutPage,
    queryFn: async () => {
      const response = await fetch('/api/v1/store/payment-options')
      const result = await response.json() as { data?: MpesaPaymentOptions; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'M-Pesa details are unavailable.')
      return result.data
    },
  })
  const ordersQuery = useQuery({
    queryKey: ['customer-orders', accountUser?.id],
    enabled: (isOrdersPage || isAccountPage || pagePath === '/account/dashboard') && Boolean(accountUser),
    queryFn: async () => {
      const response = await fetch('/api/v1/orders')
      const result = await response.json() as { data?: CustomerOrder[]; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Your orders could not be loaded.')
      return result.data
    },
  })
  const accountSummaryQuery = useQuery({
    queryKey: ['account-summary', accountUser?.id],
    enabled: (isAccountPage || pagePath === '/account/dashboard') && Boolean(accountUser),
    queryFn: async () => {
      const response = await fetch('/api/v1/account')
      const result = await response.json() as { data?: AccountSummary; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Account summary could not be loaded.')
      return result.data
    },
  })

  useEffect(() => { localStorage.setItem('kitculture-cart', JSON.stringify(cart)) }, [cart])
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/auth/me', { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ data: { user: AccountUser | null } }> : null)
      .then((result) => { setAccountUser(result?.data.user ?? null); setAuthChecked(true) })
      .catch(() => { if (!controller.signal.aborted) setAuthChecked(true) })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!introVisible) return
    const timer = window.setTimeout(() => dismissIntro(), 3000)
    return () => window.clearTimeout(timer)
  }, [introVisible])
  useEffect(() => {
    if (isCheckoutPage && authChecked && !accountUser) {
      const returnTo = isAccountCheckoutRoute ? '/account/checkout' : '/checkout'
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true })
    }
  }, [isCheckoutPage, isAccountCheckoutRoute, authChecked, accountUser, navigate])
  useEffect(() => {
    if (isAccountPortalRoute && authChecked && !accountUser) {
      const returnTo = `${location.pathname}${location.search}`
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true })
    }
  }, [isAccountPortalRoute, location.pathname, location.search, authChecked, accountUser, navigate])
  useEffect(() => {
    if (pagePath === '/account' && authChecked && accountUser) navigate('/account/dashboard', { replace: true })
    else if (isAccountPortalRoute && authChecked && accountUser && !isPortalPath && !isAccountCartRoute) navigate('/account/dashboard', { replace: true })
  }, [pagePath, authChecked, accountUser, isAccountPortalRoute, isPortalPath, isAccountCartRoute, navigate])
  useEffect(() => {
    if (isLoginPage && authChecked && accountUser) {
      navigate(safeCustomerReturnTo(new URLSearchParams(location.search).get('returnTo')) ?? '/account/dashboard', { replace: true })
    }
  }, [isLoginPage, authChecked, accountUser, location.search, navigate])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2400)
    return () => window.clearTimeout(timer)
  }, [notice])

  function dismissIntro() {
    sessionStorage.setItem('kitculture-intro-seen', 'true')
    setIntroVisible(false)
  }

  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return products.filter((product) => {
      const matchesQuery = !normalizedQuery || `${product.name} ${product.description} ${product.category?.name ?? ''}`.toLowerCase().includes(normalizedQuery)
      const matchesCategory = activeCategory === 'All kits' || product.category?.name.toLowerCase().includes(activeCategory.replace(' kits', '').toLowerCase())
      return matchesQuery && matchesCategory
    })
  }, [products, query, activeCategory])
  const homepageJerseyCategories = products.reduce<{ slug: string; name: string; imageUrl: string | null }[]>((items, product) => {
    const category = product.jerseyCategory
    if (category && !items.some((item) => item.slug === category.slug)) items.push({ slug: category.slug, name: category.name, imageUrl: product.imageUrl })
    return items
  }, []).slice(0, 8)
  const productTeams = products.reduce<HomepageTeam[]>((teams, product) => {
    if (product.team && !teams.some((team) => team.id === product.team?.id)) teams.push({ ...product.team, productCount: products.filter((item) => item.team?.id === product.team?.id).length })
    return teams
  }, [])
  const directoryTeams = homepageQuery.data?.leagues.flatMap((league) => league.teams) ?? []
  const homepageTeams = (directoryTeams.length ? directoryTeams : productTeams)
    .filter((team) => homepageTrendingClubOrder.has(team.slug))
    .sort((left, right) => (homepageTrendingClubOrder.get(left.slug) ?? 0) - (homepageTrendingClubOrder.get(right.slug) ?? 0))
  const homeFeaturedProducts = query.trim() || activeCategory !== 'All kits'
    ? visibleProducts
    : trendingQuery.data?.length ? trendingQuery.data : visibleProducts

  const itemCount = cart.reduce((total, line) => total + line.quantity, 0)
  const subtotal = cart.reduce((total, line) => total + line.price * line.quantity, 0)
  const checkoutCart = buyNowItems ?? cart
  const checkoutSubtotal = checkoutCart.reduce((total, line) => total + line.price * line.quantity, 0)
  const checkoutDeliveryFee = Number(deliveryZones.find((zone) => zone.id === Number(checkoutDeliveryZoneId))?.fee ?? 0)

  function addToCart(product: Product | ShopProduct, selection?: Variant | ShopVariant | ShopPurchaseSelection[]) {
    const selections = Array.isArray(selection)
      ? selection
      : selection ? [{ variant: selection, quantity: 1 }]
        : product.variants.find((variant) => variant.stock > 0) ? [{ variant: product.variants.find((variant) => variant.stock > 0)!, quantity: 1 }] : []
    if (!selections.length) {
      setNotice('This item is currently out of stock.')
      return
    }
    const selectedQuantity = selections.reduce((total, item) => total + item.quantity, 0)
    const existingQuantity = cart.filter((line) => line.productId === product.id).reduce((total, line) => total + line.quantity, 0)
    if (existingQuantity + selectedQuantity > 5) {
      setNotice('The available stock limit is already in your bag.')
      return
    }
    for (const item of selections) {
      const existing = cart.find((line) => line.productId === product.id && line.size === item.variant.size)
      if (existing && existing.quantity + item.quantity > item.variant.stock) {
        setNotice(`Only ${item.variant.stock} ${item.variant.size} kits are available.`)
        return
      }
    }
    setCart((current) => {
      const next = [...current]
      for (const item of selections) {
        const index = next.findIndex((line) => line.productId === product.id && line.size === item.variant.size)
        if (index >= 0) next[index] = { ...next[index]!, quantity: next[index]!.quantity + item.quantity }
        else next.push({ productId: product.id, variantId: item.variant.id, name: product.name, price: Number(item.variant.price ?? product.salePrice ?? product.price), imageUrl: product.imageUrl, size: item.variant.size, stock: item.variant.stock, quantity: item.quantity })
      }
      return next
    })
    setNotice(`${selectedQuantity} ${product.name} ${selectedQuantity === 1 ? 'kit' : 'kits'} added to your bag`)
  }

  async function buyNow(_product: ShopProduct, selections: ShopPurchaseSelection[], details: BuyNowCheckoutDetails) {
    if (!accountUser) {
      navigate(`/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`)
      setNotice('Sign in to place your order. Your checkout details will need to be entered again.')
      return
    }
    const response = await fetch('/api/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': details.idempotencyKey },
      body: JSON.stringify({
        items: selections.map(({ variant, quantity }) => ({ variantId: variant.id, quantity })),
        deliveryZoneId: details.deliveryZoneId,
        paymentMethod: 'mpesa',
        address: {
          recipientName: accountUser.fullName,
          phone: accountUser.phone,
          address: details.address,
          county: details.county,
          town: details.town,
          estate: details.estate,
          landmark: details.landmark,
          latitude: details.latitude,
          longitude: details.longitude,
          ...(details.accuracy !== undefined ? { accuracy: details.accuracy } : {}),
        },
      }),
    })
    const result = await response.json() as { data?: { orderNumber: string; total: string }; error?: { message?: string } }
    if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'We could not create your order.')

    let noticeMessage = `Order ${result.data.orderNumber} was created, but the payment prompt could not start. Try again from order details.`
    try {
      const promptResponse = await fetch(`/api/v1/orders/${encodeURIComponent(result.data.orderNumber)}/mpesa/stk-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: details.payerPhone }),
      })
      const promptResult = await promptResponse.json() as { data?: { message?: string }; error?: { message?: string } }
      noticeMessage = promptResponse.ok
        ? `M-Pesa prompt sent to ${details.payerPhone}. Confirm ${money.format(Number(result.data.total))} to KitCulture.`
        : `Order ${result.data.orderNumber} was created, but the prompt could not start: ${promptResult.error?.message ?? 'Try again from order details.'}`
    } catch {
      // The order is already created; keep it available for payment retry.
    }
    setNotice(noticeMessage)
    navigate(`/account/orders/${encodeURIComponent(result.data.orderNumber)}`)
  }

  function updateQuantity(productId: number, size: string, quantity: number) {
    setCart((current) => quantity < 1 ? current.filter((line) => line.productId !== productId || line.size !== size) : current.map((line) => line.productId === productId && line.size === size ? { ...line, quantity: Math.min(quantity, 5, line.stock) } : line))
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthError('')
    setAuthFieldErrors({})
    const submittedForm = event.currentTarget
    const form = new FormData(event.currentTarget)
    const raw = Object.fromEntries(form.entries())
    const showValidationErrors = (issues: { path: PropertyKey[]; message: string }[]) => {
      const fieldErrors: Partial<Record<'fullName' | 'email' | 'password' | 'passwordConfirmation', string>> = {}
      for (const issue of issues) {
        const field = issue.path[0]
        if (typeof field === 'string' && ['fullName', 'email', 'password', 'passwordConfirmation'].includes(field)) {
          fieldErrors[field as keyof typeof fieldErrors] ??= issue.message
        }
      }
      setAuthFieldErrors(fieldErrors)
      const firstField = issues[0]?.path[0]
      if (typeof firstField === 'string') {
        const control = submittedForm.elements.namedItem(firstField)
        if (control instanceof HTMLElement) control.focus()
      }
    }
    let payload: { email: string; password: string; fullName?: string }
    if (activeAuthMode === 'register') {
      const parsed = registrationSchema.safeParse(raw)
      if (!parsed.success) {
        showValidationErrors(parsed.error.issues)
        return
      }
      payload = { email: parsed.data.email, password: parsed.data.password, fullName: parsed.data.fullName }
    } else {
      const parsed = signInSchema.safeParse(raw)
      if (!parsed.success) {
        showValidationErrors(parsed.error.issues)
        return
      }
      payload = parsed.data
    }

    setAuthBusy(true)
    try {
      const response = await fetch(`/api/v1/auth/${activeAuthMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json() as { data?: { user: AccountUser; emailVerified: boolean }; error?: { message: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Account request failed.')
      if (activeAuthMode === 'register') {
        const email = encodeURIComponent(result.data.user.email)
        const returnTo = safeCustomerReturnTo(new URLSearchParams(location.search).get('returnTo'))
        const next = new URLSearchParams({ registered: '1', email })
        if (returnTo) next.set('returnTo', returnTo)
        submittedForm.reset()
        navigate(`/login?${next.toString()}`, { replace: true })
        return
      }
      setAccountUser(result.data.user)
      setNotice(`Welcome, ${result.data.user.fullName}`)
      const returnTo = safeCustomerReturnTo(new URLSearchParams(location.search).get('returnTo'))
      if (returnTo) navigate(returnTo, { replace: true })
      else if (isLoginPage) navigate('/account/dashboard', { replace: true })
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Account request failed.')
    } finally {
      setAuthBusy(false)
    }
  }

  function clearAuthFieldError(field: 'fullName' | 'email' | 'password' | 'passwordConfirmation') {
    setAuthFieldErrors((current) => ({ ...current, [field]: undefined }))
    setAuthError('')
  }

  async function signOut() {
    await fetch('/api/v1/auth/logout', { method: 'POST' })
    setAccountUser(null)
    setNotice('You have been signed out.')
    navigate('/login', { replace: true })
  }

  async function saveToWishlist(productId: number) {
    if (!accountUser) {
      navigate(`/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`)
      setNotice('Sign in to save a jersey to your wishlist.')
      return
    }
    try {
      const response = await fetch('/api/v1/account/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Could not save this jersey.')
      setNotice('Jersey saved to your wishlist.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save this jersey.')
    }
  }

  function beginCheckout() {
    setBuyNowItems(null)
    if (!accountUser) {
      setCartOpen(false)
      setAuthError('')
      navigate('/login?returnTo=%2Fcheckout')
      setNotice('Sign in or create an account to continue. Your bag is saved.')
      return
    }
    setCheckoutError('')
    setCheckoutPinStatus('')
    setCheckoutIdempotencyKey(crypto.randomUUID())
    setCheckoutOpen(true)
  }

  function captureDeliveryLocation(form: HTMLFormElement) {
    const latitude = form.elements.namedItem('latitude')
    const longitude = form.elements.namedItem('longitude')
    const accuracy = form.elements.namedItem('accuracy')
    if (latitude instanceof HTMLInputElement) latitude.value = ''
    if (longitude instanceof HTMLInputElement) longitude.value = ''
    if (accuracy instanceof HTMLInputElement) accuracy.value = ''
    setCheckoutLocation(null)
    setCheckoutLatitude('')
    setCheckoutLongitude('')
    setCheckoutAccuracy(null)
    if (!navigator.geolocation) {
      setCheckoutPinStatus('Location sharing is not available in this browser.')
      return
    }
    setCheckoutPinStatus('Finding your delivery location…')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = form.elements.namedItem('latitude')
        const longitude = form.elements.namedItem('longitude')
        const accuracy = form.elements.namedItem('accuracy')
        if (!(latitude instanceof HTMLInputElement) || !(longitude instanceof HTMLInputElement) || !(accuracy instanceof HTMLInputElement)) {
          setCheckoutPinStatus('The delivery pin could not be attached to this order.')
          return
        }
        latitude.value = String(position.coords.latitude)
        longitude.value = String(position.coords.longitude)
        accuracy.value = String(position.coords.accuracy)
        setCheckoutLatitude(latitude.value)
        setCheckoutLongitude(longitude.value)
        setCheckoutAccuracy(position.coords.accuracy)
        setCheckoutLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy })
        setCheckoutPinStatus(`Pin saved with approximately ${Math.round(position.coords.accuracy)} m accuracy. Pin again outdoors for a more precise location.`)
      },
      (error) => setCheckoutPinStatus(error.code === error.PERMISSION_DENIED
        ? 'Allow location access in your browser to pin the delivery address.'
        : 'Your delivery location could not be found. Enter the address and try again.'),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
    )
  }

  function updateDeliveryCoordinate(form: HTMLFormElement, axis: 'latitude' | 'longitude') {
    const latitude = form.elements.namedItem('latitude')
    const longitude = form.elements.namedItem('longitude')
    const accuracy = form.elements.namedItem('accuracy')
    if (!(latitude instanceof HTMLInputElement) || !(longitude instanceof HTMLInputElement)) return
    if (accuracy instanceof HTMLInputElement) accuracy.value = ''
    const latitudeValue = latitude.value.trim()
    const longitudeValue = longitude.value.trim()
    setCheckoutLatitude(latitudeValue)
    setCheckoutLongitude(longitudeValue)
    setCheckoutAccuracy(null)
    if (!latitudeValue || !longitudeValue) {
      setCheckoutLocation(null)
      setCheckoutPinStatus('Enter both coordinates to preview the delivery pin.')
      return
    }
    const latitudeNumber = Number(latitudeValue)
    const longitudeNumber = Number(longitudeValue)
    if (latitudeNumber < -90 || latitudeNumber > 90 || longitudeNumber < -180 || longitudeNumber > 180) {
      setCheckoutLocation(null)
      setCheckoutPinStatus('Latitude must be between -90 and 90; longitude between -180 and 180.')
      return
    }
    setCheckoutLocation({ latitude: latitudeNumber, longitude: longitudeNumber, accuracy: null })
    setCheckoutPinStatus(`Pin adjusted manually from the ${axis} field. GPS accuracy is not available for manual coordinates.`)
  }

  async function submitCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCheckoutError('')
    if (!event.currentTarget.reportValidity()) return
    const form = new FormData(event.currentTarget)
    const deliveryZoneId = Number(form.get('deliveryZoneId'))
    const paymentMethod = String(form.get('paymentMethod') ?? 'pay_on_delivery')
    const latitudeValue = String(form.get('latitude') ?? '').trim()
    const longitudeValue = String(form.get('longitude') ?? '').trim()
    const accuracyValue = String(form.get('accuracy') ?? '').trim()
    if (paymentMethod === 'mpesa' && !mpesaPaymentOptions?.stkPushAvailable) {
      setCheckoutError('M-PESA Express is unavailable until Daraja is configured.')
      return
    }
    if (paymentMethod === 'mpesa' && !/^(?:0[17]\d{8}|\+?254[17]\d{8})$/.test(mpesaPhone.replace(/[\s()-]/g, ''))) {
      setCheckoutError('Enter a valid Kenyan M-PESA phone number.')
      return
    }
    if (!latitudeValue || !longitudeValue) {
      setCheckoutError('Pin your delivery location before placing the order.')
      setCheckoutPinStatus('A delivery pin is required.')
      return
    }
    const items = checkoutCart.flatMap((line) => {
      const product = products.find((entry) => entry.id === line.productId)
      const variantId = line.variantId ?? product?.variants.find((variant) => variant.size === line.size)?.id
      return variantId ? [{ variantId, quantity: line.quantity }] : []
    })
    if (!deliveryZoneId || items.length !== checkoutCart.length) {
      setCheckoutError('Some items in your bag are no longer available. Refresh the shop and try again.')
      return
    }

    setCheckoutBusy(true)
    try {
      const idempotencyKey = checkoutIdempotencyKey || crypto.randomUUID()
      if (!checkoutIdempotencyKey) setCheckoutIdempotencyKey(idempotencyKey)
      const response = await fetch('/api/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          items,
          deliveryZoneId,
          paymentMethod,
          address: {
            recipientName: String(form.get('recipientName') ?? ''),
            phone: String(form.get('phone') ?? ''),
            address: String(form.get('address') ?? ''),
            county: String(form.get('county') ?? ''),
            town: String(form.get('town') ?? ''),
            estate: String(form.get('estate') ?? ''),
            landmark: String(form.get('landmark') ?? ''),
            instructions: String(form.get('instructions') ?? ''),
            ...(latitudeValue && longitudeValue ? { latitude: Number(latitudeValue), longitude: Number(longitudeValue) } : {}),
            ...(accuracyValue ? { accuracy: Number(accuracyValue) } : {}),
          },
        }),
      })
      const result = await response.json() as { data?: { orderNumber: string; status: string; total: string }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'We could not create your order.')
      let noticeMessage = `Order ${result.data.orderNumber} placed. Pay on Delivery selected.`
      if (paymentMethod === 'mpesa') {
        const promptResponse = await fetch(`/api/v1/orders/${encodeURIComponent(result.data.orderNumber)}/mpesa/stk-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: mpesaPhone }),
        })
        const promptResult = await promptResponse.json() as { data?: { message?: string }; error?: { message?: string } }
        noticeMessage = promptResponse.ok
          ? `M-Pesa prompt sent to your account phone. Approve it, then check order ${result.data.orderNumber}.`
          : `Order ${result.data.orderNumber} was created, but the prompt could not start: ${promptResult.error?.message ?? 'Try again from order details.'}`
      }
      if (buyNowItems === null) setCart([])
      setBuyNowItems(null)
      setCartOpen(false)
      setCheckoutOpen(false)
      setNotice(noticeMessage)
      navigate(paymentMethod === 'mpesa' ? `/account/orders/${encodeURIComponent(result.data.orderNumber)}` : '/account/orders')
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'We could not create your order.')
    } finally {
      setCheckoutBusy(false)
    }
  }

  async function cancelOrder(orderNumber: string) {
    setOrderActionError('')
    setOrderActionBusy(orderNumber)
    try {
      const response = await fetch(`/api/v1/orders/${encodeURIComponent(orderNumber)}/cancel`, { method: 'POST' })
      const result = response.status === 204 ? null : await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result?.error?.message ?? 'This order could not be cancelled.')
      await ordersQuery.refetch()
      setNotice(`Order ${orderNumber} cancelled. Reserved stock has been released.`)
    } catch (error) {
      setOrderActionError(error instanceof Error ? error.message : 'This order could not be cancelled.')
    } finally {
      setOrderActionBusy('')
    }
  }

  if (isAdminPage) return <AdminRoute />

  if (isAccountPortalRoute || isCustomerAuthRoute) {
    if (!authChecked) return <div className="standalone-page auth-checking"><div className="catalogue-state"><strong>Checking your account…</strong></div></div>
    if (isAccountPortalRoute && (!accountUser || pagePath === '/account' || !isPortalPath)) {
      return <div className="standalone-page auth-checking"><div className="catalogue-state"><strong>{accountUser ? 'Opening your account…' : 'Taking you to sign in…'}</strong></div></div>
    }
    if (isLoginPage && accountUser) return null
    const authPage = isLoginPage
      ? <CustomerAuthForm
          mode={activeAuthMode}
          busy={authBusy}
          error={authError}
          fieldErrors={authFieldErrors}
          onFieldChange={clearAuthFieldError}
          registered={new URLSearchParams(location.search).get('registered') === '1'}
          email={new URLSearchParams(location.search).get('email') ?? ''}
          returnTo={safeCustomerReturnTo(new URLSearchParams(location.search).get('returnTo')) ?? ''}
          onSubmit={(event) => void submitAuth(event)}
        />
      : <CustomerAuthInfoPage kind={pagePath === '/forgot-password' ? 'forgot' : pagePath === '/reset-password' ? 'reset' : 'verify'} />
    if (isCustomerAuthRoute) return <AuthLayout>{authPage}</AuthLayout>
    if (!accountUser) return null
    const content = pagePath === '/account' || pagePath === '/account/dashboard'
      ? <CustomerPortalOverview
          user={accountUser}
          orders={ordersQuery.data ?? []}
          summary={accountSummaryQuery.data}
          ordersLoading={ordersQuery.isPending}
          ordersError={ordersQuery.isError ? ordersQuery.error.message : undefined}
          summaryError={accountSummaryQuery.isError ? accountSummaryQuery.error.message : undefined}
          featuredKits={<CustomerDashboardKits products={portalDashboardKitsQuery.data ?? []} error={portalDashboardKitsQuery.isError ? portalDashboardKitsQuery.error.message : undefined} onAdd={addToCart} onSave={(productId) => void saveToWishlist(productId)} />}
          onRetry={() => { void ordersQuery.refetch(); void accountSummaryQuery.refetch() }}
        />
      : isAccountCartRoute
        ? <section className="standalone-page page-width cart-page portal-cart-page">
            <header className="portal-cart-heading"><div><span className="eyebrow">YOUR LINEUP</span><h1>Shopping bag</h1><p>{itemCount} {itemCount === 1 ? 'kit' : 'kits'} in your bag</p></div><Link to="/account/marketplace" className="portal-cart-continue">Continue shopping <ArrowRight size={15} /></Link></header>
            {cart.length === 0 ? <div className="catalogue-state"><strong>Your bag is empty.</strong><span>Browse the marketplace and find your colours.</span><Link className="button button-green" to="/account/marketplace">Browse kits <ArrowRight size={15} /></Link></div> : <>
              <div className="portal-cart-panel"><div className="cart-page-lines">{cart.map((line) => <article className="cart-line" key={`${line.productId}-${line.size}`}>
                {line.imageUrl ? <img src={line.imageUrl} alt={line.name} /> : <div className="cart-image-placeholder">KC</div>}
                <div className="cart-line-info"><strong>{line.name}</strong><span>Size {line.size}</span><span>{money.format(line.price)} each</span><div className="quantity-control"><button type="button" aria-label={`Remove one ${line.name}, size ${line.size}`} disabled={line.quantity <= 1} onClick={() => updateQuantity(line.productId, line.size, line.quantity - 1)}>−</button><span>{line.quantity}</span><button type="button" aria-label={`Add one ${line.name}, size ${line.size}`} disabled={line.quantity >= Math.min(5, line.stock)} onClick={() => updateQuantity(line.productId, line.size, line.quantity + 1)}>+</button></div></div>
                <strong className="portal-cart-line-total">{money.format(line.price * line.quantity)}</strong><button className="remove-line" type="button" onClick={() => updateQuantity(line.productId, line.size, 0)}>Remove</button>
              </article>)}</div>
              <div className="cart-page-total"><span>Subtotal</span><strong>{money.format(subtotal)}</strong><span className="portal-cart-delivery-note">Delivery and payment are selected at checkout.</span><Link to="/account/checkout" className="button button-green">Continue to checkout <ArrowRight size={15} /></Link></div>
              </div>
            </>}
          </section>
      : isAccountCheckoutRoute
        ? <section className="standalone-page page-width checkout-page portal-checkout-page"><Link to="/account/cart" className="standalone-back">← Back to your bag</Link><h1>Complete your order</h1>
            {zonesLoading ? <div className="catalogue-state"><strong>Loading delivery areas…</strong></div> : zonesFailed || deliveryZones.length === 0 ? <div className="catalogue-state error-state"><strong>Checkout is not available yet.</strong><span>{zonesFailed ? (zonesError instanceof Error ? zonesError.message : 'Delivery areas could not be loaded.') : 'Delivery areas have not been configured.'}</span></div> : <form className="standalone-card checkout-form" onSubmit={(event) => void submitCheckout(event)} noValidate>
              <label>Delivery area<select name="deliveryZoneId" required value={checkoutDeliveryZoneId} onChange={(event) => setCheckoutDeliveryZoneId(event.target.value)}><option value="" disabled>Select an area</option>{deliveryZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name} · {money.format(Number(zone.fee))}</option>)}</select></label>
              <CheckoutPaymentOptions paymentMethod={checkoutPaymentMethod} onPaymentMethodChange={setCheckoutPaymentMethod} mpesaOptions={mpesaPaymentOptions} accountUser={accountUser} payerPhone={mpesaPhone} onPayerPhoneChange={setMpesaPhone} />
              <div className="checkout-fields"><label>Recipient full name<input key={`recipient-${checkoutPaymentMethod}-${accountUser.id}`} name="recipientName" autoComplete="name" defaultValue={accountUser.fullName} required minLength={2} maxLength={160} /></label><label>Delivery phone number<input key={`phone-${checkoutPaymentMethod}-${accountUser.id}`} name="phone" type="tel" autoComplete="tel" defaultValue={accountUser.phone ?? ''} required minLength={7} maxLength={20} /></label></div>
              <label>Email address<input type="email" autoComplete="email" value={accountUser.email} readOnly /></label>
              <label>Street address or building<input name="address" autoComplete="street-address" required minLength={3} maxLength={180} /></label>
              <div className="checkout-fields"><label>County<input name="county" autoComplete="address-level1" defaultValue="Machakos" required maxLength={80} /></label><label>Town<input name="town" autoComplete="address-level2" defaultValue="Machakos" required maxLength={100} /></label></div>
              <label>Estate <span>(optional)</span><input name="estate" maxLength={100} /></label><label>Landmark <span>(optional)</span><input name="landmark" maxLength={180} /></label><label>Delivery instructions <span>(optional)</span><textarea name="instructions" rows={2} maxLength={500} /></label>
              <div className="checkout-fields"><label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" required value={checkoutLatitude} onChange={(event) => { setCheckoutLatitude(event.target.value); if (event.currentTarget.form) updateDeliveryCoordinate(event.currentTarget.form, 'latitude') }} /></label><label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" required value={checkoutLongitude} onChange={(event) => { setCheckoutLongitude(event.target.value); if (event.currentTarget.form) updateDeliveryCoordinate(event.currentTarget.form, 'longitude') }} /></label></div><input type="hidden" name="accuracy" value={checkoutAccuracy ?? ''} readOnly />
              <button className="button button-outline checkout-location-button" type="button" onClick={(event) => { if (event.currentTarget.form) captureDeliveryLocation(event.currentTarget.form) }}><MapPin size={15} /> Pin this delivery location</button>
              {checkoutPinStatus && <p className="checkout-location-status" role="status">{checkoutPinStatus}</p>}
              {checkoutLocation && <GoogleMapView latitude={checkoutLocation.latitude} longitude={checkoutLocation.longitude} title="Pinned delivery location" />}
              {checkoutError && <p className="auth-message" role="alert">{checkoutError}</p>}
              <div className="checkout-total"><span>Items subtotal</span><strong>{money.format(checkoutSubtotal)}</strong></div><div className="checkout-total checkout-fee"><span>Delivery</span><strong>{money.format(checkoutDeliveryFee)}</strong></div><div className="checkout-total checkout-grand-total"><span>Total due</span><strong>{money.format(checkoutSubtotal + checkoutDeliveryFee)}</strong></div>
              <p className="checkout-disclaimer">Your contact details and delivery pin are attached to the order. Stock and delivery fees are rechecked before confirmation.</p>
              <button className="button button-green" type="submit" disabled={checkoutBusy || checkoutCart.length === 0}>{checkoutBusy ? 'Creating order…' : `Place order · ${checkoutPaymentMethod === 'pay_on_delivery' ? 'Pay on Delivery' : 'M-Pesa'}`} <ArrowRight size={16} /></button>
            </form>}
          </section>
      : pagePath === '/account/marketplace' || isPortalMarketplaceTeam
        ? <MarketplacePage portalMode onSave={(productId) => void saveToWishlist(productId)} />
        : isPortalMarketplaceProduct
          ? <ProductPage portalMode onAdd={addToCart} onBuyNow={buyNow} accountUser={accountUser} onSave={(productId) => void saveToWishlist(productId)} />
      : pagePath === '/account/orders'
        ? <CustomerPortalOrdersPage
            orders={ordersQuery.data ?? []}
            loading={ordersQuery.isPending}
            error={ordersQuery.isError ? ordersQuery.error.message : undefined}
            onCancelOrder={(orderNumber) => void cancelOrder(orderNumber)}
            cancelBusy={orderActionBusy}
            cancelError={orderActionError}
            onRetry={() => void ordersQuery.refetch()}
          />
        : pagePath === '/account/chat'
          ? <CustomerChatPage user={accountUser} />
          : <CustomerPortalPage path={pagePath} user={accountUser} onProfileUpdate={(fullName, phone) => setAccountUser((current) => current ? { ...current, fullName, phone } : current)} />
    return <CustomerPortalLayout currentPath={pagePath} user={accountUser} itemCount={itemCount} onSignOut={() => void signOut()}>{content}</CustomerPortalLayout>
  }

  return (
    <div className={`public-storefront${isHomePage ? ' is-home' : ''}`}>
      {introVisible && <div className="brand-intro" aria-label="KitCulture introduction">
        <div className="intro-identity">
          <img className="intro-logo" src={cultureLogo} alt="" />
          <div className="intro-wordmark" aria-label="KitCulture">
            {'KitCulture'.split('').map((letter, index) => <span key={`${letter}-${index}`} style={{ '--letter-index': index } as CSSProperties & { '--letter-index': number }}>{letter}</span>)}
          </div>
          <p className="intro-tagline">Wear Your Colours. Live the Culture.</p>
        </div>
        <button type="button" onClick={dismissIntro}>Skip intro <ArrowRight size={15} /></button>
      </div>}

      <div className={isHomePage ? 'store-header-stack is-home' : 'store-header-stack'}>
        {!isHomePage && <div className="announcement">Machakos, this is your matchday uniform <span>Dispatch begins in Machakos</span></div>}
        <header className="site-header">
        <Link className="wordmark" to="/" aria-label="KitCulture home"><img src={cultureLogo} alt="" /><span className="wordmark-copy"><strong>KitCulture</strong><small>Wear Your Colours. Live the Culture.</small></span></Link>
        <nav className={mobileOpen ? 'main-nav is-open' : 'main-nav'} aria-label="Main navigation">
          <Link to="/" onClick={() => setMobileOpen(false)}>Home</Link>
          <Link to="/shop" onClick={() => setMobileOpen(false)}>Shop Jerseys <ChevronDown size={13} /></Link>
          <Link to="/marketplace" onClick={() => setMobileOpen(false)}>Clubs <ChevronDown size={13} /></Link>
          <Link to="/categories/national-team-kits" onClick={() => setMobileOpen(false)}>National Teams <ChevronDown size={13} /></Link>
          <Link to={accountUser ? '/account' : '/login'} onClick={() => setMobileOpen(false)}>Account</Link>
          <Link to="/new-arrivals" onClick={() => setMobileOpen(false)}>New Arrivals</Link>
        </nav>
        <div className="header-actions">
          <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for jerseys, teams..." aria-label="Search jerseys" /></label>
          <Link className="icon-button account-button" to={accountUser ? '/account' : '/login'} aria-label={accountUser ? `Account for ${accountUser.fullName}` : 'Sign in or create an account'}><UserRound size={19} /></Link>
          <Link className="icon-button wishlist-button" to={accountUser ? '/account/wishlist' : '/login'} aria-label="Wishlist"><Heart size={19} /></Link>
          <Link className="icon-button bag-button" to="/cart" aria-label={`Open shopping bag, ${itemCount} items`}><ShoppingBag size={20} /><span className="bag-count">{itemCount}</span></Link>
          <button className="icon-button mobile-menu-button" type="button" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X /> : <Menu />}</button>
        </div>
        </header>
      </div>

      <main>
        {isAccountPortalRoute && !authChecked && <section className="standalone-page page-width"><div className="catalogue-state"><strong>Checking your account…</strong></div></section>}
        {isHomePage && <div className="store-home">
        {activeHeroProduct || activeSlide ? <section className="hero hero-dynamic home-hero" id="home">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" />{activeHeroProduct?.team?.name ?? activeSlide?.promotionalMessage ?? 'Built for the stands. Ready for the street.'}</div>
            <h1>{activeHeroProduct?.name ?? activeSlide?.title}</h1>
            <p>{activeHeroProduct ? 'A fresh kit, ready for matchday. Find your size and wear your colours.' : activeSlide?.subtitle}</p>
            <div className="hero-actions"><Link className="button button-green" to={activeHeroProduct ? `/products/${activeHeroProduct.slug}` : activeSlide?.destinationUrl ?? '/shop'}>{activeHeroProduct ? 'Shop this kit' : activeSlide?.ctaLabel ?? 'Shop now'} <ArrowRight size={16} /></Link><a className="text-link" href="#story">The KitCulture story <ArrowDown size={14} /></a></div>
            <div className="hero-footnote"><span className="live-dot" /> Machakos-born. Matchday-ready.</div>
          </div>
          <div className="hero-image hero-slide-image">
            <img key={activeHeroProduct?.id ?? activeSlide?.id} className={`hero-slide-photo${activeHeroProduct ? ' hero-kit-photo' : ''}`} src={activeHeroProduct?.imageUrl ?? activeSlide?.imageUrl} alt={activeHeroProduct?.name ?? activeSlide?.title ?? 'KitCulture kit'} />
            <div className="hero-image-shade" />
            <div className="hero-image-caption"><span>{String(activeSlideIndex + 1).padStart(2, '0')} / KITCULTURE</span><span>{activeHeroProduct?.name ?? activeSlide?.ctaLabel}</span></div>
            {heroSlideCount > 1 && <div className="hero-slide-controls"><button type="button" aria-label="Previous homepage kit" onClick={() => setActiveSlideIndex((index) => (index - 1 + heroSlideCount) % heroSlideCount)}>←</button><span>{activeSlideIndex + 1} / {heroSlideCount}</span><button type="button" aria-label="Next homepage kit" onClick={() => setActiveSlideIndex((index) => (index + 1) % heroSlideCount)}>→</button></div>}
          </div>
          <div className="hero-index">KITCULTURE — EST. MACHAKOS</div>
        </section> : <section className="hero home-hero" id="home">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> Built for the stands. Ready for the street.</div>
            <h1>Your team.<br />Your colours.<br /><em>Your culture.</em></h1>
            <p>For the ones who sing before kickoff and long after the final whistle. Find the shirt that feels like home.</p>
            <div className="hero-actions"><a className="button button-green" href="#shop">Shop the collection <ArrowRight size={16} /></a><a className="text-link" href="#story">The KitCulture story <ArrowDown size={14} /></a></div>
            <div className="hero-footnote"><span className="live-dot" /> Machakos-born. Matchday-ready.</div>
          </div>
          <div className="hero-image hero-kit-image" role="img" aria-label="Featured football kit from the KitCulture catalogue">
            <img className="hero-stadium-photo" src="https://www.fanzonett.com/cdn/shop/files/football_jerseys_560x438.jpg?v=1650496524" alt="Football jerseys" />
            <div className="hero-image-shade" />
            <div className="hero-image-caption"><span>01 / THE KIT</span><span>Wear your colours</span></div>
          </div>
          <div className="hero-index">KITCULTURE — EST. MACHAKOS</div>
        </section>}

        <section className="ticker" aria-label="Brand message"><div>THE GAME IS OURS <span>✳</span> THE GAME IS OURS <span>✳</span> THE GAME IS OURS <span>✳</span> THE GAME IS OURS <span>✳</span></div></section>

        <section className="home-clubs page-width" aria-label="Trending teams">
          <div className="home-clubs-card">
          <div className="home-section-heading"><div><div className="eyebrow">Trending Teams</div><h2>Shop Your Favourite Clubs</h2></div><Link className="home-view-all" to="/marketplace">View All Teams <ArrowRight size={15} /></Link></div>
          <div className={`home-club-grid${showAllTrendingTeams ? ' is-expanded' : ''}`} id="trending-club-grid">{homepageTeams.map((team, index) => {
            const badgeId = homepageTrendingClubBadges[team.slug]
            const extraClasses = `${index >= 8 ? ' is-extra-desktop' : ''}${index >= 4 ? ' is-extra-tablet' : ''}${index >= 2 ? ' is-extra-mobile' : ''}`
            const expandButton = (placement: string) => <button key={placement} className={`home-club-expand home-club-expand-${placement}${showAllTrendingTeams ? ' is-expanded' : ''}`} type="button" aria-expanded={showAllTrendingTeams} aria-controls="trending-club-grid" onClick={() => setShowAllTrendingTeams((expanded) => !expanded)}>{showAllTrendingTeams ? 'See less' : 'See more'} <ChevronDown size={15} /></button>
            return <Fragment key={team.id}>
              <Link className={`home-club-card${extraClasses}`} to={`/marketplace?team=${encodeURIComponent(team.slug)}`}>
                <span className="home-club-image"><img src={`https://crests.football-data.org/${badgeId}.png`} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true }} /></span>
                <strong>{team.name}</strong><small>{team.productCount} products</small><span className="home-club-link">View Collection <ArrowRight size={13} /></span>
              </Link>
              {index === 1 && homepageTeams.length > 2 && expandButton('mobile')}
              {index === 3 && homepageTeams.length > 4 && expandButton('tablet')}
              {index === 7 && homepageTeams.length > 8 && expandButton('desktop')}
            </Fragment>
          })}</div>
          </div>
        </section>

        {(homepageQuery.data?.leagues.length ?? 0) > 0 && <section className="home-league-groups page-width" aria-label="Shop by league and team">
          <div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> Find your side</div><h2>Leagues. <em>Legacies.</em></h2></div><Link className="text-link" to="/marketplace">Open marketplace <ArrowRight size={15} /></Link></div>
          <div className="home-league-grid">{homepageQuery.data?.leagues.map((league) => <article className="home-league-card" key={league.id}>
            <Link className="home-league-title" to={`/marketplace?league=${encodeURIComponent(league.slug)}`}><span className="marketplace-country">{league.countryCode}</span><span><strong>{league.name}</strong><small>{league.country} · {league.season}</small></span><ArrowRight size={16} /></Link>
            <div className="home-league-teams">{league.teams.slice(0, 8).map((team) => <Link key={team.id} to={`/marketplace?league=${encodeURIComponent(league.slug)}&team=${encodeURIComponent(team.slug)}`}>{team.name}<small>{team.productCount}</small></Link>)}{league.teams.length > 8 && <Link to={`/marketplace?league=${encodeURIComponent(league.slug)}`}>+{league.teams.length - 8} more teams</Link>}</div>
          </article>)}</div>
        </section>}

        <section className="shop-section page-width" id="shop">
          <div className="shop-section-card">
          <div className="section-heading">
            <div><div className="eyebrow">Trending Jerseys</div><h2>Most Popular Right Now</h2></div>
            <Link className="text-link" to="/shop">View All Jerseys <ArrowRight size={15} /></Link>
          </div>
          <div className="shop-toolbar">
            <div className="category-tabs" role="group" aria-label="Filter products by collection">{categories.map((category) => <button key={category} className={activeCategory === category ? 'category-tab active' : 'category-tab'} type="button" onClick={() => setActiveCategory(category)}>{category}</button>)}</div>
            <span className="result-count">{loading ? 'Loading collection…' : `${visibleProducts.length} ${visibleProducts.length === 1 ? 'piece' : 'pieces'}`}</span>
          </div>
          {catalogueError && <div className="catalogue-state error-state"><strong>Our catalogue is temporarily unavailable.</strong><span>Live product and stock information could not be loaded. Please try again shortly.</span></div>}
          {!catalogueError && loading && <div className="product-grid" aria-label="Loading products">{[1, 2, 3, 4].map((item) => <div className="product-skeleton" key={item}><div /><span /><span /></div>)}</div>}
          {!catalogueError && !loading && homeFeaturedProducts.length > 0 && <div className="product-grid">{homeFeaturedProducts.slice(0, 6).map((product) => {
            const inStock = product.variants.some((variant) => variant.stock > 0)
            return <article className="product-card" key={product.id}>
              <div className="product-media">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy" /> : <div className="product-image-empty"><span>KC</span><small>IMAGE TO BE ADDED</small></div>}
                {(product.featured || product.trending) && <span className="product-tag">{product.trending ? 'TRENDING' : 'FEATURED'}</span>}
                {(product.salePrice || product.featured || product.trending) && <span className={`product-tag${product.salePrice ? ' product-tag-sale' : ''}`}>{product.salePrice ? 'SALE' : product.trending ? 'TRENDING' : 'FEATURED'}</span>}
                <button className="product-favourite" type="button" aria-label={`Save ${product.name} to your wishlist`} onClick={() => void saveToWishlist(product.id)}><Heart size={14} /></button>
              </div>
              <div className="product-info"><div><ProductCategoryLine team={product.team?.name} league={product.league?.name} jerseyCategory={product.jerseyCategory?.name} category={product.category?.name} fallback="KitCulture" /><h3><Link to={`/products/${product.slug}`}>{product.name}</Link></h3></div><span className="product-price">{product.salePrice ? <><del>{money.format(Number(product.price))}</del><strong className="sale-price">{money.format(Number(product.salePrice))}</strong></> : money.format(Number(product.price))}</span></div>
              <ProductRating rating={product.ratingAverage} count={product.reviewCount} />
              <div className="product-meta"><div className="product-sizes">{product.variants.length ? product.variants.map((variant) => <span className={!variant.stock ? 'is-sold-out' : ''} key={variant.id}>{variant.size}</span>) : <span>Unavailable</span>}</div><span className={inStock ? 'stock-label' : 'stock-label sold-out'}>{inStock ? 'In stock' : 'Out of stock'}</span></div>
              {inStock ? <button className="quick-add" type="button" onClick={() => addToCart(product)} aria-label={`Add ${product.name} to cart`}><ShoppingCart size={13} />Add to Cart</button> : <Link className="quick-add quick-add-preview" to={`/products/${product.slug}`}><ShoppingCart size={13} />Buy</Link>}
            </article>
          })}</div>}
          {!catalogueError && !loading && homeFeaturedProducts.length === 0 && <div className="catalogue-state"><span className="catalogue-mark">KC</span><strong>{products.length ? 'No kits found for that search.' : 'A fresh season starts here.'}</strong><span>{products.length ? 'Try another phrase or collection.' : 'New pieces will appear here once inventory is added in the admin catalogue.'}</span></div>}
          </div>
        </section>

        <section className="home-categories page-width">
          <div className="home-section-heading"><div><div className="eyebrow">Shop by Category</div><h2>Find the Perfect Jersey</h2></div></div>
          <div className="home-category-groups">{homepageJerseyCategories.map((category) => <HomepageProductSection key={category.slug} title={category.name} kicker="KIT COLLECTION" products={products.filter((product) => product.jerseyCategory?.slug === category.slug).slice(0, 6)} onAdd={addToCart} onSave={(productId) => void saveToWishlist(productId)} categoryImageUrl={category.imageUrl} shopAllHref={`/shop?category=${encodeURIComponent(category.slug)}`} showAll />)}</div>
        </section>

        <HomepageProductSection id="new-arrivals" title="Latest Jerseys. Fresh Style." kicker="New Arrivals" products={newArrivalsQuery.data ?? []} error={newArrivalsQuery.isError ? newArrivalsQuery.error.message : undefined} onAdd={addToCart} onSave={(productId) => void saveToWishlist(productId)} shopAllHref="/new-arrivals" shopAllLabel="View all arrivals" showAll />

        <section className="home-service-strip" aria-label="Shopping benefits">
          <div><Truck size={28} /><span><strong>Convenient Delivery</strong><small>Machakos Town &amp; beyond</small></span></div>
          <div><ShieldCheck size={28} /><span><strong>Secure Shopping</strong><small>Your data is protected</small></span></div>
          <div><Smartphone size={28} /><span><strong>M-Pesa Payments</strong><small>Fast. Safe. Convenient.</small></span></div>
          <div><Star size={28} /><span><strong>Football Culture</strong><small>More than just jerseys</small></span></div>
        </section>
        </div>}
        {isShopPage && <ShopPage key={pagePath} onSave={(productId) => void saveToWishlist(productId)} />}
        {isMarketplacePage && <MarketplacePage onSave={(productId) => void saveToWishlist(productId)} />}
        {isProductPage && <ProductPage onAdd={addToCart} onBuyNow={buyNow} accountUser={accountUser} onSave={(productId) => void saveToWishlist(productId)} />}
        {isCartPage && <section className="standalone-page page-width cart-page"><Link to="/shop" className="standalone-back"><ArrowDown size={14} /> Continue shopping</Link><h1>Your matchday bag</h1>
          {cart.length === 0 ? <div className="catalogue-state"><strong>Your bag is empty.</strong><span>Browse the team catalogue and find your colours.</span><Link className="button button-green" to="/shop">Shop teams <ArrowRight size={15} /></Link></div> : <><div className="cart-page-lines">{cart.map((line) => <article className="cart-line" key={`${line.productId}-${line.size}`}>{line.imageUrl ? <img src={line.imageUrl} alt="" /> : <div className="cart-image-placeholder">KC</div>}<div className="cart-line-info"><strong>{line.name}</strong><span>Size {line.size}</span><span>{money.format(line.price)}</span><div className="quantity-control"><button type="button" aria-label={`Remove one ${line.name}`} onClick={() => updateQuantity(line.productId, line.size, line.quantity - 1)}>−</button><span>{line.quantity}</span><button type="button" aria-label={`Add one ${line.name}`} onClick={() => updateQuantity(line.productId, line.size, line.quantity + 1)}>+</button></div></div><button className="remove-line" type="button" onClick={() => updateQuantity(line.productId, line.size, 0)}>Remove</button></article>)}</div><div className="cart-page-total"><span>Subtotal (delivery calculated at checkout)</span><strong>{money.format(subtotal)}</strong><Link to="/checkout" className="button button-green">Continue to checkout <ArrowRight size={15} /></Link></div></>}
        </section>}
        {isCheckoutPage && <section className="standalone-page page-width checkout-page"><Link to="/cart" className="standalone-back">← Back to your bag</Link><h1>Delivery details</h1>
          {zonesLoading ? <div className="catalogue-state"><strong>Loading delivery areas…</strong></div> : zonesFailed || deliveryZones.length === 0 ? <div className="catalogue-state error-state"><strong>Checkout is not available yet.</strong><span>{zonesFailed ? (zonesError instanceof Error ? zonesError.message : 'Delivery areas could not be loaded.') : 'Delivery areas have not been configured.'}</span></div> : <form className="standalone-card checkout-form" onSubmit={(event) => void submitCheckout(event)} noValidate>
            <label>Delivery area<select name="deliveryZoneId" required value={checkoutDeliveryZoneId} onChange={(event) => setCheckoutDeliveryZoneId(event.target.value)}><option value="" disabled>Select an area</option>{deliveryZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name} · {money.format(Number(zone.fee))}</option>)}</select></label>
            <CheckoutPaymentOptions paymentMethod={checkoutPaymentMethod} onPaymentMethodChange={setCheckoutPaymentMethod} mpesaOptions={mpesaPaymentOptions} accountUser={accountUser} payerPhone={mpesaPhone} onPayerPhoneChange={setMpesaPhone} />
            <div className="checkout-fields"><label>Recipient full name<input key={`recipient-${checkoutPaymentMethod}-${accountUser?.id ?? 'guest'}`} name="recipientName" autoComplete="name" defaultValue={accountUser?.fullName ?? ''} readOnly={checkoutPaymentMethod === 'mpesa'} required minLength={2} maxLength={160} /></label><label>Phone number<input key={`phone-${checkoutPaymentMethod}-${accountUser?.id ?? 'guest'}`} name="phone" type="tel" autoComplete="tel" defaultValue={accountUser?.phone ?? ''} readOnly={checkoutPaymentMethod === 'mpesa'} required minLength={7} maxLength={20} /></label></div>
            <label>Email address<input type="email" autoComplete="email" value={accountUser?.email ?? ''} readOnly /></label>
            <label>Street address or building<input name="address" autoComplete="street-address" required minLength={3} maxLength={180} /></label>
            <div className="checkout-fields"><label>County<input name="county" autoComplete="address-level1" defaultValue="Machakos" required maxLength={80} /></label><label>Town<input name="town" autoComplete="address-level2" defaultValue="Machakos" required maxLength={100} /></label></div>
            <label>Estate <span>(optional)</span><input name="estate" maxLength={100} /></label><label>Landmark <span>(optional)</span><input name="landmark" maxLength={180} /></label><label>Delivery instructions <span>(optional)</span><textarea name="instructions" rows={2} maxLength={500} /></label>
            <div className="checkout-fields"><label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" required value={checkoutLatitude} onChange={(event) => { setCheckoutLatitude(event.target.value); if (event.currentTarget.form) updateDeliveryCoordinate(event.currentTarget.form, 'latitude') }} /></label><label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" required value={checkoutLongitude} onChange={(event) => { setCheckoutLongitude(event.target.value); if (event.currentTarget.form) updateDeliveryCoordinate(event.currentTarget.form, 'longitude') }} /></label></div><input type="hidden" name="accuracy" value={checkoutAccuracy ?? ''} readOnly />
            <button className="button button-outline checkout-location-button" type="button" onClick={(event) => { if (event.currentTarget.form) captureDeliveryLocation(event.currentTarget.form) }}><MapPin size={15} /> Pin this delivery location</button>
            {checkoutPinStatus && <p className="checkout-location-status" role="status">{checkoutPinStatus}</p>}
            {checkoutLocation && <GoogleMapView latitude={checkoutLocation.latitude} longitude={checkoutLocation.longitude} title="Pinned delivery location" />}
            {checkoutError && <p className="auth-message" role="alert">{checkoutError}</p>}
            <div className="checkout-total"><span>Items subtotal</span><strong>{money.format(checkoutSubtotal)}</strong></div>
            <div className="checkout-total checkout-fee"><span>Delivery</span><strong>{money.format(checkoutDeliveryFee)}</strong></div>
            <div className="checkout-total checkout-grand-total"><span>Total due</span><strong>{money.format(checkoutSubtotal + checkoutDeliveryFee)}</strong></div>
            <p className="checkout-disclaimer">Your contact details and delivery pin are attached to the order. Stock and delivery fees are rechecked before confirmation.</p>
            <button className="button button-green" type="submit" disabled={checkoutBusy || checkoutCart.length === 0}>{checkoutBusy ? 'Creating order…' : `Place order · ${checkoutPaymentMethod === 'pay_on_delivery' ? 'Pay on Delivery' : 'M-Pesa'}`} <ArrowRight size={16} /></button>
          </form>}
        </section>}
        {isNotFoundPage && <section className="standalone-page page-width"><div className="catalogue-state"><strong>That page is not in our lineup.</strong><span>Check the address or head back to the shop.</span><Link className="button button-green" to="/shop">Browse teams <ArrowRight size={15} /></Link></div></section>}
      </main>

      <footer className="site-footer" id="contact"><div className="footer-top">
        <div className="footer-brand"><Link className="wordmark footer-wordmark" to="/" aria-label="KitCulture home"><img src={cultureLogo} alt="" /><span className="wordmark-copy"><strong>KitCulture</strong><small>Wear Your Colours. Live the Culture.</small></span></Link><p>Your one-stop shop for authentic football jerseys. From the global giants to local favourites, we bring the colours you live in.</p></div>
        <nav className="footer-links" aria-label="Shop links"><strong>Shop</strong><Link to="/shop">All Jerseys</Link><Link to="/marketplace">Club Jerseys</Link><Link to="/categories/national-team-kits">National Teams</Link><Link to="/new-arrivals">New Arrivals</Link></nav>
        <nav className="footer-links" aria-label="Customer links"><strong>Customer Support</strong><Link to="/account/orders">My Orders</Link><Link to="/account/profile">My Account</Link><Link to="/cart">Shopping Bag</Link><Link to="/login">Sign In</Link></nav>
        <nav className="footer-links" aria-label="KitCulture links"><strong>About KitCulture</strong><Link to="/marketplace">Our Marketplace</Link><Link to="/shop">Football Culture</Link><span>Machakos, Kenya</span></nav>
      </div><div className="footer-bottom"><span>© 2026 KitCulture. All rights reserved.</span><div><span>Powered by KitCulture</span></div></div></footer>

      {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
      {cartOpen && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false) }}><aside className="cart-drawer" aria-label={checkoutOpen ? 'Checkout' : 'Shopping bag'} aria-modal="true" role="dialog">
        <div className="drawer-heading"><div><span className="eyebrow">{checkoutOpen ? 'DELIVERY DETAILS' : 'YOUR LINEUP'}</span><h2>{checkoutOpen ? 'Where to?' : <>Matchday bag <span>({itemCount})</span></>}</h2></div><button className="icon-button" type="button" aria-label="Close bag" onClick={() => { setCartOpen(false); setCheckoutOpen(false) }}><X /></button></div>
        {checkoutOpen ? <div className="checkout-panel">
          <button className="checkout-back" type="button" onClick={() => { setCheckoutOpen(false); setCheckoutError('') }}>← Back to your bag</button>
          {zonesLoading ? <div className="catalogue-state"><strong>Loading delivery areas…</strong></div> : zonesFailed || deliveryZones.length === 0 ? <div className="catalogue-state"><strong>Checkout is not available yet.</strong><span>{zonesFailed ? (zonesError instanceof Error ? zonesError.message : 'Delivery areas could not be loaded.') : 'Delivery areas have not been configured. Please try again later.'}</span></div> : <form className="checkout-form" onSubmit={(event) => void submitCheckout(event)} noValidate>
            <label>Delivery area<select name="deliveryZoneId" required value={checkoutDeliveryZoneId} onChange={(event) => setCheckoutDeliveryZoneId(event.target.value)}><option value="" disabled>Select an area</option>{deliveryZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name} · {money.format(Number(zone.fee))}</option>)}</select></label>
            <CheckoutPaymentOptions paymentMethod={checkoutPaymentMethod} onPaymentMethodChange={setCheckoutPaymentMethod} mpesaOptions={mpesaPaymentOptions} accountUser={accountUser} payerPhone={mpesaPhone} onPayerPhoneChange={setMpesaPhone} />
            <div className="checkout-fields"><label>Recipient full name<input key={`recipient-${checkoutPaymentMethod}-${accountUser?.id ?? 'guest'}`} name="recipientName" autoComplete="name" defaultValue={accountUser?.fullName ?? ''} readOnly={checkoutPaymentMethod === 'mpesa'} required minLength={2} maxLength={160} /></label><label>Phone number<input key={`phone-${checkoutPaymentMethod}-${accountUser?.id ?? 'guest'}`} name="phone" type="tel" autoComplete="tel" defaultValue={accountUser?.phone ?? ''} readOnly={checkoutPaymentMethod === 'mpesa'} required minLength={7} maxLength={20} /></label></div>
            <label>Email address<input type="email" autoComplete="email" value={accountUser?.email ?? ''} readOnly /></label>
            <label>Street address or building<input name="address" autoComplete="street-address" required minLength={3} maxLength={180} /></label>
            <div className="checkout-fields"><label>County<input name="county" autoComplete="address-level1" defaultValue="Machakos" required maxLength={80} /></label><label>Town<input name="town" autoComplete="address-level2" defaultValue="Machakos" required maxLength={100} /></label></div>
            <label>Estate <span>(optional)</span><input name="estate" maxLength={100} /></label>
            <label>Landmark <span>(optional)</span><input name="landmark" maxLength={180} /></label>
            <label>Delivery instructions <span>(optional)</span><textarea name="instructions" rows={2} maxLength={500} /></label>
            <div className="checkout-fields"><label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" required value={checkoutLatitude} onChange={(event) => { setCheckoutLatitude(event.target.value); if (event.currentTarget.form) updateDeliveryCoordinate(event.currentTarget.form, 'latitude') }} /></label><label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" required value={checkoutLongitude} onChange={(event) => { setCheckoutLongitude(event.target.value); if (event.currentTarget.form) updateDeliveryCoordinate(event.currentTarget.form, 'longitude') }} /></label></div><input type="hidden" name="accuracy" value={checkoutAccuracy ?? ''} readOnly />
            <button className="button button-outline checkout-location-button" type="button" onClick={(event) => { if (event.currentTarget.form) captureDeliveryLocation(event.currentTarget.form) }}><MapPin size={15} /> Pin this delivery location</button>
            {checkoutPinStatus && <p className="checkout-location-status" role="status">{checkoutPinStatus}</p>}
            {checkoutLocation && <GoogleMapView latitude={checkoutLocation.latitude} longitude={checkoutLocation.longitude} title="Pinned delivery location" />}
            {checkoutError && <p className="auth-message" role="alert">{checkoutError}</p>}
            <div className="checkout-total"><span>Items subtotal</span><strong>{money.format(checkoutSubtotal)}</strong></div>
            <div className="checkout-total checkout-fee"><span>Delivery</span><strong>{money.format(checkoutDeliveryFee)}</strong></div>
            <div className="checkout-total checkout-grand-total"><span>Total due</span><strong>{money.format(checkoutSubtotal + checkoutDeliveryFee)}</strong></div>
            <p className="checkout-disclaimer">Your contact details and delivery pin are attached to the order. Stock and delivery fees are rechecked before confirmation.</p>
            <button className="button button-green" type="submit" disabled={checkoutBusy || checkoutCart.length === 0}>{checkoutBusy ? 'Creating order…' : `Place order · ${checkoutPaymentMethod === 'pay_on_delivery' ? 'Pay on Delivery' : 'M-Pesa'}`} <ArrowRight size={16} /></button>
          </form>}
        </div> : cart.length === 0 ? <div className="empty-cart"><ShoppingBag size={28} /><strong>Nothing in your bag. Yet.</strong><span>Your next favourite shirt is waiting in the shop.</span><button className="button button-green" type="button" onClick={() => setCartOpen(false)}>Explore the shop <ArrowRight size={15} /></button></div> : <><div className="cart-lines">{cart.map((line) => <article className="cart-line" key={`${line.productId}-${line.size}`}>{line.imageUrl ? <img src={line.imageUrl} alt="" /> : <div className="cart-image-placeholder">KC</div>}<div className="cart-line-info"><strong>{line.name}</strong><span>Size {line.size}</span><span>{money.format(line.price)}</span><div className="quantity-control"><button type="button" aria-label={`Remove one ${line.name}`} onClick={() => updateQuantity(line.productId, line.size, line.quantity - 1)}>−</button><span>{line.quantity}</span><button type="button" aria-label={`Add one ${line.name}`} onClick={() => updateQuantity(line.productId, line.size, line.quantity + 1)}>+</button></div></div><button className="remove-line" type="button" onClick={() => updateQuantity(line.productId, line.size, 0)}>Remove</button></article>)}</div><div className="drawer-total"><div><span>Subtotal</span><strong>{money.format(subtotal)}</strong></div><p>Delivery calculated at checkout.</p><button className="button button-green" type="button" onClick={beginCheckout}>Continue to checkout <ArrowRight size={16} /></button><small>Sign in is required. Your bag stays saved in this browser.</small></div></>}
      </aside></div>}
    </div>
  )
}

export default App
