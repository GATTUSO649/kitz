import { ArrowRight, BadgeCheck, CalendarDays, CheckCircle2, CircleHelp, Clock3, Compass, House, LayoutGrid, List as ListIcon, LoaderCircle, Mail, MapPin, Moon, PackageCheck, Phone, Search, ShieldCheck, ShoppingBag, Shirt, SlidersHorizontal, Sparkles, Sun, Truck, X, Zap } from 'lucide-react'
import { FaFacebookF, FaWhatsapp, FaXTwitter, FaYoutube } from 'react-icons/fa6'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { marketplaceFetch, marketplaceUnavailableEvent } from './api'
import { SiteContentParagraphs, SiteContentValue, SiteImage, usePlatformSiteContent, type SiteContentOverrides } from './SiteImages'
import { SellListingPage, SubmissionStatusPage } from './SellListingPage'
import { MarketplaceAdminPage } from './MarketplaceAdmin'
import { SellerForgotPasswordPage, SellerLoginPage, SellerPortalPage, SellerResetPasswordPage, SellerSignupPage, SellerVerifyPage } from './SellerPortal'

const kitzOrigin = import.meta.env.VITE_KITZ_ORIGIN || 'https://kitz.onrender.com'
const matrixIntroStorageKey = 'matrix-intro-seen'
const laundrySettingsStorageKey = 'laundry-page-settings'
const laundryBookingsStorageKey = 'laundry-bookings'
const themeStorageKey = 'markethub-theme'
const formatKes = (value: number) => `KSh ${new Intl.NumberFormat('en-KE').format(value)}`
const normalizeWhatsAppNumber = (value: string) => {
  const digits = value.replace(/\D/g, '')
  const international = digits.startsWith('0') ? `254${digits.slice(1)}` : digits
  return /^254[17]\d{8}$/.test(international) ? international : null
}

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

type LaundryPageSettings = {
  title: string
  subtitle: string
  description: string
  heroImage: string
  locationLabel: string
  locationQuery: string
  phone: string
  email: string
}

type LaundryBooking = {
  id: string
  name: string
  phone: string
  email: string
  location: string
  address: string
  service: string
  quantity: number
  quantityUnit: string
  preferredDate: string
  preferredTime: string
  notes: string
  createdAt: string
  status: 'new' | 'confirmed' | 'ready'
}

type MarketplaceCategory = { id: string; name: string; slug: string; subcategories?: { id: string; name: string; slug: string }[] }
type MarketplaceCounty = { code: string; name: string }
type FooterSocialLinks = { facebookUrl: string | null; xUrl: string | null; youtubeUrl: string | null; whatsappUrl: string | null; whatsappPhone: string | null; contactEmail: string | null; contactPhone: string | null }
type CatalogueFilters = { county: string; subcounty: string; town: string; condition: string; minPrice: string; maxPrice: string; publishedAfter: string; publishedBefore: string; negotiable: string; sort: string; featured: string; subcategory: string }

const defaultLaundrySettings: LaundryPageSettings = {
  title: 'Laundry & Dry Cleaning',
  subtitle: 'Reliable washing, pickup, and delivery for busy households and professionals.',
  description: 'From daily wear to weekend essentials, we help families and individuals keep their clothes fresh, neatly folded, and ready to wear. Choose a service, share your pickup details, and our team will schedule a pickup from your preferred location.',
  heroImage: '/images/laundry-wash-fold.jpg',
  locationLabel: 'Machakos Town',
  locationQuery: 'Machakos Town, Kenya',
  phone: '',
  email: '',
}

function readStoredValue<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function writeStoredValue<T>(key: string, value: T) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage may be disabled
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => readStoredValue(themeStorageKey, 'light'))

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    writeStoredValue(themeStorageKey, theme)
  }, [theme])

  return <button type="button" className="theme-toggle" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
    {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
    <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
  </button>
}

function safeSocialProfile(value: string, hosts: string[]): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.toString() : null
  } catch {
    return null
  }
}

function contentValue(value: string | undefined, fallback: string | null, validate: (input: string) => string | null) {
  return value === undefined ? fallback : value.trim() ? validate(value.trim()) : null
}

function resolveFooterSocial(content: SiteContentOverrides, fallback: FooterSocialLinks): FooterSocialLinks {
  const whatsappPhone = content.platformWhatsappPhone === undefined
    ? fallback.whatsappPhone
    : normalizeWhatsAppNumber(content.platformWhatsappPhone)
  const contactEmail = contentValue(content.platformContactEmail, fallback.contactEmail, (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : null)
  const contactPhone = contentValue(content.platformContactPhone, fallback.contactPhone, normalizeWhatsAppNumber)
  return {
    facebookUrl: contentValue(content.platformFacebookUrl, fallback.facebookUrl, (value) => safeSocialProfile(value, ['facebook.com', 'fb.com'])),
    xUrl: contentValue(content.platformXUrl, fallback.xUrl, (value) => safeSocialProfile(value, ['x.com', 'twitter.com'])),
    youtubeUrl: contentValue(content.platformYoutubeUrl, fallback.youtubeUrl, (value) => safeSocialProfile(value, ['youtube.com', 'youtu.be'])),
    whatsappPhone,
    whatsappUrl: content.platformWhatsappPhone === undefined ? fallback.whatsappUrl : whatsappPhone ? `https://wa.me/${whatsappPhone}` : null,
    contactEmail,
    contactPhone,
  }
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
    marketplaceFetch(`/api/v1/marketplace/products?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { data?: Listing[]; pagination?: { page: number; limit: number; total: number; hasMore: boolean }; error?: { message?: string } }
        if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Listings could not be loaded.')
        setListings(result.data)
        setPagination(result.pagination ?? null)
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Listings could not be loaded.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [search, category, filterQuery, page, retry])

  if (loading) return <div className={`listing-grid ${view === 'list' ? 'list-view' : ''}`} aria-label="Loading listings">{Array.from({ length: 4 }, (_, index) => <div className="listing-skeleton" key={index} />)}</div>
  if (error) return <div className="catalogue-message" role="alert"><strong>Listings are unavailable.</strong><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>
  if (!listings.length) return <div className="catalogue-message"><strong>No listings found.</strong><span>Try a different search or category.</span></div>
  return <>
    <div className={`listing-grid ${view === 'list' ? 'list-view' : ''}`}>{listings.map((listing, index) => <article className="listing-card" key={listing.reference}>
      <Link to={`/marketplace/products/${encodeURIComponent(listing.slug)}`} className="listing-image">
        {listing.imageUrl ? <img src={listing.imageUrl} alt={listing.title} loading={index < 4 ? 'eager' : 'lazy'} decoding="async" fetchPriority={index === 0 ? 'high' : 'auto'} width="640" height="480" /> : <span aria-label="No product image">No image</span>}
        {listing.featured && <b>Featured</b>}
      </Link>
      <div className="listing-info"><small><MapPin size={11} /> {listing.town}, {listing.county}</small><Link to={`/marketplace/products/${encodeURIComponent(listing.slug)}`}><strong>{listing.title}</strong></Link><div><b>KSh {new Intl.NumberFormat('en-KE').format(listing.priceKes)}</b><span>{listing.negotiable ? 'Negotiable' : listing.condition.replaceAll('_', ' ')}</span></div></div>
      <Link className="listing-whatsapp-cta" to={`/marketplace/products/${encodeURIComponent(listing.slug)}?intent=whatsapp`} aria-label={`Pay contact fee to reach the seller of ${listing.title} on WhatsApp`}><FaWhatsapp size={15} /> WhatsApp seller</Link>
    </article>)}</div>
    {pagination && pagination.total > pagination.limit && <nav className="catalogue-pagination" aria-label="Product pages"><button type="button" disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>Previous</button><span>Page {pagination.page} · {pagination.total} listings</span><button type="button" disabled={!pagination.hasMore} onClick={() => onPageChange(pagination.page + 1)}>Next</button></nav>}
  </>
}

type LaundryRoutePage = 'home' | 'services' | 'pricing' | 'book' | 'track' | 'how-it-works' | 'gallery' | 'about' | 'contact' | 'faqs'

const laundryNavigation: { label: string; path: string; page: LaundryRoutePage }[] = [
  { label: 'Home', path: '/laundry', page: 'home' },
  { label: 'Services', path: '/laundry/services', page: 'services' },
  { label: 'Pricing', path: '/laundry/pricing', page: 'pricing' },
  { label: 'Book Pickup', path: '/laundry/book', page: 'book' },
  { label: 'Track Booking', path: '/laundry/track', page: 'track' },
  { label: 'Gallery', path: '/laundry/gallery', page: 'gallery' },
  { label: 'About', path: '/laundry/about', page: 'about' },
  { label: 'Contact', path: '/laundry/contact', page: 'contact' },
]

function LaundryPage({ page }: { page: LaundryRoutePage }) {
  const [settings, setSettings] = useState<LaundryPageSettings>(() => readStoredValue(laundrySettingsStorageKey, defaultLaundrySettings))
  const [pageSearchParams] = useSearchParams()
  const selectedService = pageSearchParams.get('service')
  const [form, setForm] = useState({ name: '', phone: '', email: '', location: '', address: '', exactLocation: '', service: selectedService ?? 'Wash & Fold', quantity: '1', quantityUnit: 'bag', preferredDate: '', preferredTime: '', notes: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [bookingConfirmation, setBookingConfirmation] = useState<LaundryBooking | null>(null)
  const [trackingReference, setTrackingReference] = useState('')
  const [trackingPhone, setTrackingPhone] = useState('')
  const [trackedBooking, setTrackedBooking] = useState<LaundryBooking | null>(null)
  const [trackingError, setTrackingError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const siteContent = usePlatformSiteContent()
  const whatsappNumber = normalizeWhatsAppNumber(siteContent.platformWhatsappPhone ?? '')
  const whatsappUrl = whatsappNumber ? `https://wa.me/${whatsappNumber}` : null
  const supportPhone = siteContent.platformContactPhone || settings.phone
  const supportEmail = siteContent.platformContactEmail || settings.email

  useEffect(() => {
    setSettings(readStoredValue(laundrySettingsStorageKey, defaultLaundrySettings))
  }, [])

  useEffect(() => {
    const supportedServices = ['Wash & Fold', 'Dry Cleaning', 'Ironing', 'Express Laundry', 'Bedding & Duvets', 'Pickup & Delivery']
    if (selectedService && supportedServices.includes(selectedService)) setForm((current) => ({ ...current, service: selectedService }))
  }, [selectedService])

  useEffect(() => {
    const titles: Record<LaundryRoutePage, string> = {
      home: 'MATRIX Laundry | Fresh care, collected and returned',
      services: 'Laundry Services | MATRIX Laundry',
      pricing: 'Pricing & Quotations | MATRIX Laundry',
      book: 'Book a Pickup | MATRIX Laundry',
      track: 'Track a Booking | MATRIX Laundry',
      'how-it-works': 'How It Works | MATRIX Laundry',
      gallery: 'Laundry Gallery | MATRIX Laundry',
      about: 'About MATRIX Laundry',
      contact: 'Contact MATRIX Laundry',
      faqs: 'Laundry FAQs | MATRIX Laundry',
    }
    const descriptions: Record<LaundryRoutePage, string> = {
      home: 'Convenient laundry pickup and garment care from MATRIX Laundry in Machakos.',
      services: 'Explore wash and fold, dry cleaning, ironing, bedding care and pickup services.',
      pricing: 'Request a laundry quotation from MATRIX. Current service prices are not yet published.',
      book: 'Request laundry pickup by sharing your service, quantity, address and preferred schedule.',
      track: 'Check the latest recorded status for your MATRIX Laundry booking.',
      'how-it-works': 'See how MATRIX Laundry pickup, garment care and return works.',
      gallery: 'View the MATRIX Laundry service and garment care gallery.',
      about: 'Learn about MATRIX Laundry and our approach to convenient local garment care.',
      contact: 'Contact MATRIX Laundry for booking, quotation and customer support.',
      faqs: 'Answers to common MATRIX Laundry booking and service questions.',
    }
    document.title = titles[page]
    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (!description) {
      description = document.createElement('meta')
      description.name = 'description'
      document.head.append(description)
    }
    description.content = descriptions[page]
    window.scrollTo(0, 0)
  }, [page])

  const serviceCards = [
    { title: 'Wash & Fold', description: 'Fresh everyday laundry with careful washing, drying and neatly folded finishing.', icon: Shirt, image: '/images/laundry-ironing.jpg' },
    { title: 'Dry Cleaning', description: 'Professional garment care for delicate clothing, uniforms and special pieces.', icon: Sparkles, image: '/images/laundry-dry-cleaning.jpg' },
    { title: 'Ironing', description: 'Perfect finishing for shirts, dresses, workwear and household essentials.', icon: CheckCircle2, image: '/images/laundry-pickup.jpg' },
    { title: 'Express Laundry', description: 'Quick turnaround for time-sensitive requests when you need items back fast.', icon: Clock3, image: '/images/laundry-express.jpg' },
    { title: 'Bedding & Duvets', description: 'Deep cleaning for bed linens, duvet covers and large household textiles.', icon: PackageCheck, image: '/images/laundry-bedding.jpg' },
    { title: 'Pickup & Delivery', description: 'Convenient collection and return service for busy homes and offices.', icon: Truck, image: '/images/laundry-wash-fold.jpg' },
  ]

  const steps = [
    { title: 'Choose Your Service', description: 'Select the care option that fits your laundry needs and schedule.' },
    { title: 'Schedule Your Pickup', description: 'Tell us when and where we should collect your clothes.' },
    { title: 'We Clean Your Clothes', description: 'Our team washes, dries and finishes everything with care.' },
    { title: 'Receive Your Fresh Laundry', description: 'We return your garments clean, folded and ready to wear.' },
  ]

  const benefits = [
    { title: 'Convenient Pickup and Delivery', description: 'Simple collection and return scheduling for busy households and offices.', icon: Truck },
    { title: 'Professional Garment Care', description: 'Careful handling to keep your clothes fresh, neat and in great condition.', icon: ShieldCheck },
    { title: 'Reliable Service', description: 'Punctual support from a team focused on dependable results.', icon: BadgeCheck },
    { title: 'Customer Support', description: 'Friendly assistance whenever you need help with timing or service details.', icon: Phone },
  ]

  const gallery = serviceCards.map((service) => ({ src: service.image, alt: `${service.title} laundry service` }))

  const validateForm = () => {
    const nextErrors: Record<string, string> = {}
    const cleanedName = form.name.trim()
    const cleanedEmail = form.email.trim()
    const cleanedPhone = form.phone.trim()
    const cleanedAddress = form.address.trim()

    if (!cleanedName) nextErrors.name = 'Please enter your full name.'
    if (!cleanedPhone) nextErrors.phone = 'Phone number is required.'
    else {
      const digits = cleanedPhone.replace(/\D/g, '')
      const normalized = digits.startsWith('0') ? `254${digits.slice(1)}` : digits
      if (!/^254[17]\d{8}$/.test(normalized)) nextErrors.phone = 'Use a valid Kenyan mobile number, for example 0712 345 678.'
    }
    if (!cleanedEmail) nextErrors.email = 'Email address is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) nextErrors.email = 'Enter a valid email address.'
    if (!cleanedAddress) nextErrors.address = 'Please add your street or home address.'
    if (!form.service) nextErrors.service = 'Please choose a service.'
    if (!Number.isFinite(Number(form.quantity)) || Number(form.quantity) < 1) nextErrors.quantity = 'Enter a quantity of at least 1.'
    if (!form.preferredDate) nextErrors.preferredDate = 'Choose a preferred pickup date.'
    else if (form.preferredDate < new Date().toISOString().slice(0, 10)) nextErrors.preferredDate = 'Choose today or a future date.'
    if (!form.preferredTime) nextErrors.preferredTime = 'Choose a preferred pickup time.'
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setNotice('')
    setBookingConfirmation(null)
    if (!validateForm()) return

    const bookings = readStoredValue<LaundryBooking[]>(laundryBookingsStorageKey, [])
    const reference = `LAUN-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`
    const booking: LaundryBooking = {
      id: reference,
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      location: form.location.trim() || settings.locationLabel,
      address: form.address.trim(),
      service: form.service,
      quantity: Number(form.quantity),
      quantityUnit: form.quantityUnit,
      preferredDate: form.preferredDate,
      preferredTime: form.preferredTime,
      notes: `${form.exactLocation ? `Exact pickup location: ${form.exactLocation}. ` : ''}${form.notes.trim()}`.trim(),
      createdAt: new Date().toISOString(),
      status: 'new',
    }

    setSubmitting(true)
    try {
      const next = [booking, ...bookings]
      writeStoredValue(laundryBookingsStorageKey, next)
      setBookingConfirmation(booking)
      setNotice('Your pickup request has been received. Our team will contact you shortly to confirm the collection time.')
      setForm({ name: '', phone: '', email: '', location: '', address: '', exactLocation: '', service: 'Wash & Fold', quantity: '1', quantityUnit: 'bag', preferredDate: '', preferredTime: '', notes: '' })
      setErrors({})
    } finally {
      setSubmitting(false)
    }
  }

  const trackLaundryBooking = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTrackedBooking(null)
    setTrackingError('')
    const normalizedPhone = normalizeWhatsAppNumber(trackingPhone)
    if (!normalizedPhone || !trackingReference.trim()) {
      setTrackingError('Enter the booking reference and the Kenyan mobile number used to book.')
      return
    }
    const match = readStoredValue<LaundryBooking[]>(laundryBookingsStorageKey, []).find((booking) =>
      booking.id.toLowerCase() === trackingReference.trim().toLowerCase()
      && normalizeWhatsAppNumber(booking.phone) === normalizedPhone)
    if (!match) {
      setTrackingError('No matching booking was found in this browser. Check the details or contact support.')
      return
    }
    setTrackedBooking(match)
  }

  const statusLabel = (status: LaundryBooking['status']) => ({ new: 'Pickup requested', confirmed: 'Pickup scheduled', ready: 'Ready for delivery' })[status]

  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.locationQuery)}`

  return <main className="laundry-page-shell">
    <header className="laundry-header">
      <div className="laundry-header-inner">
        <Link to="/laundry" className="laundry-brand" aria-label="MATRIX Laundry home">
          <SiteImage slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" />
        </Link>

        <button className="laundry-menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="laundry-navigation" onClick={() => setMenuOpen((open) => !open)}>
          {menuOpen ? <X size={18} /> : <LayoutGrid size={18} />}<span>{menuOpen ? 'Close menu' : 'Menu'}</span>
        </button>
        <nav id="laundry-navigation" className={`laundry-nav${menuOpen ? ' is-open' : ''}`} aria-label="Laundry navigation">
          {laundryNavigation.map((item) => <Link key={item.path} className={`laundry-nav-link${page === item.page ? ' is-active' : ''}`} to={item.path} aria-current={page === item.page ? 'page' : undefined} onClick={() => setMenuOpen(false)}>{item.label}</Link>)}
          <Link className="laundry-nav-extra" to="/laundry/how-it-works" onClick={() => setMenuOpen(false)}>How it works</Link>
          <Link className="laundry-nav-extra" to="/laundry/faqs" onClick={() => setMenuOpen(false)}>FAQs</Link>
        </nav>

        <div className="laundry-header-actions">
          <ThemeToggle />
          <Link className="laundry-browse-button" to="/marketplace#products">Browse listings</Link>
        </div>
      </div>
    </header>

    <main className={`laundry-main laundry-page-${page}`}>
      {page !== 'home' && <section className="laundry-page-intro">
        <span className="section-kicker">MATRIX LAUNDRY / {page.replaceAll('-', ' ').toUpperCase()}</span>
        <h1>{({ services: 'Care for every kind of laundry', pricing: 'Know the price before we begin', book: 'Arrange your pickup', track: 'Your order, clearly tracked', 'how-it-works': 'From your door and back again', gallery: 'A closer look at our care', about: 'Laundry care with a local touch', contact: 'We are here to help', faqs: 'Answers before laundry day' } as Record<LaundryRoutePage, string>)[page]}</h1>
        <p>{({ services: 'Choose a service for everyday garments, delicate pieces and household linens.', pricing: 'Our current prices are not published yet. Request a quotation and our team will confirm the amount before work begins.', book: 'Share your laundry needs and preferred pickup window. The team will confirm your collection.', track: 'Use your booking reference and phone number to check the latest recorded status.', 'how-it-works': 'A simple, thoughtful process from collection through cleaning and return.', gallery: 'The details that make laundry feel fresh, orderly and ready to wear.', about: 'Reliable pickup and careful garment handling for homes and professionals in Machakos.', contact: 'Ask a question, discuss a quote, or get help with an existing booking.', faqs: 'Find practical details about bookings, pickup, garment care and quotations.' } as Record<LaundryRoutePage, string>)[page]}</p>
      </section>}
      {page === 'home' && <section className="laundry-hero">
        <div className="laundry-hero-copy">
          <span className="hero-kicker"><Sparkles size={14} /> MATRIX CLEAN SERVICE</span>
          <h1>Fresh laundry, collected and returned with care.</h1>
          <p>Enjoy fresh, clean and neatly cared-for clothes with convenient laundry services, reliable pickup and delivery.</p>
          <div className="laundry-hero-meta">
            <span><MapPin size={14} /> {settings.locationLabel}</span>
            {supportPhone && <span><Phone size={14} /> {supportPhone}</span>}
          </div>
          <div className="laundry-hero-actions">
            <Link className="primary-action" to="/laundry/book">Book a Pickup</Link>
            <Link className="secondary-action" to="/laundry/services">Explore Our Services</Link>
          </div>
          <div className="laundry-hero-badges" aria-label="Service highlights">
            <div><strong>Pickup</strong><small>Machakos Town</small></div>
            <div><strong>Care</strong><small>Professional finish</small></div>
            <div><strong>Support</strong><small>Friendly service</small></div>
          </div>
        </div>

        <div className="laundry-hero-media" aria-label="Laundry equipment and folded clothes">
          <img src={settings.heroImage || '/images/laundry-wash-fold.jpg'} alt="Empty professional laundromat with washing machines" loading="eager" onError={(event) => { event.currentTarget.src = '/images/laundry-wash-fold.jpg' }} />
          <div className="laundry-float-card">
            <span className="status-pill">Pickup available</span>
            <strong>{settings.locationLabel}</strong>
            <small>Fast collection and return</small>
          </div>
        </div>
      </section>}

      {(page === 'home' || page === 'services') && <section id="services" className="laundry-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">OUR SERVICES</span>
            <h2>Everything you need for clean, fresh clothes</h2>
          </div>
        </div>

        <div className="service-grid">
          {(page === 'home' ? serviceCards.slice(0, 3) : serviceCards).map(({ title, description, icon: Icon, image }) => (
            <article className="service-card" key={title}>
              <img className="service-card-image" src={image} alt={`${title} service`} loading="lazy" decoding="async" />
              <div className="service-icon"><Icon size={24} /></div>
              <h3>{title}</h3>
              <p>{description}</p>
              <Link to={`/laundry/book?service=${encodeURIComponent(title)}`}>Book service <ArrowRight size={15} /></Link>
            </article>
          ))}
        </div>
        {page === 'home' && <Link className="text-action" to="/laundry/services">View all services <ArrowRight size={16} /></Link>}
      </section>}

      {page === 'pricing' && <section id="pricing" className="laundry-section laundry-pricing-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">PRICING</span>
            <h2>Clear quote before we begin</h2>
          </div>
        </div>
        <div className="pricing-notice">
          <div className="service-icon"><BadgeCheck size={24} /></div>
          <div><h3>We confirm the price with you first</h3><p>Current service rates have not been published. Send a pickup request or contact us for a quote; no charge is taken through this form.</p></div>
          <Link className="text-action" to="/laundry/book">Request a quotation <ArrowRight size={15} /></Link>
          {whatsappUrl && <a className="primary-action" href={`${whatsappUrl}?text=${encodeURIComponent('Hello MATRIX Laundry, please share your current service prices.')}`} target="_blank" rel="noreferrer"><FaWhatsapp size={17} /> Request prices</a>}
        </div>
      </section>}

      {(page === 'home' || page === 'how-it-works') && <section className="laundry-section how-it-works">
        <div className="section-heading center-heading">
          <div>
            <span className="section-kicker">HOW IT WORKS</span>
            <h2>Simple steps to fresh laundry</h2>
          </div>
        </div>

        <div className="steps-grid">
          {steps.map((step, index) => (
            <article className="step-card" key={step.title}>
              <span className="step-number">0{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
        {page === 'home' && <Link className="text-action" to="/laundry/how-it-works">See the full process <ArrowRight size={16} /></Link>}
      </section>}

      {page === 'book' && <section id="booking" className="laundry-booking-section">
        <div className="booking-copy">
          <span className="section-kicker">BOOKING</span>
          <h2>Schedule Your Laundry Pickup</h2>
          <p>Tell us what you need cleaned and where we should collect it.</p>
          <div className="booking-summary">
            <div><MapPin size={18} /><span>{settings.locationLabel}</span></div>
            {supportPhone && <div><Phone size={18} /><span>{supportPhone}</span></div>}
            <div><CalendarDays size={18} /><span>Flexible pickup scheduling</span></div>
          </div>
        </div>

        <form className="laundry-booking-form" onSubmit={handleSubmit} noValidate>
          <div className="booking-fields">
            <div className="field-group">
              <label htmlFor="laundry-name">Full Name</label>
              <input id="laundry-name" name="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Your full name" aria-invalid={Boolean(errors.name)} />
              {errors.name && <small className="field-error">{errors.name}</small>}
            </div>

            <div className="field-group">
              <label htmlFor="laundry-phone">Phone Number</label>
              <input id="laundry-phone" name="phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="0712 345 678" inputMode="tel" aria-invalid={Boolean(errors.phone)} />
              {errors.phone && <small className="field-error">{errors.phone}</small>}
            </div>

            <div className="field-group">
              <label htmlFor="laundry-email">Email Address</label>
              <input id="laundry-email" name="email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@example.com" aria-invalid={Boolean(errors.email)} />
              {errors.email && <small className="field-error">{errors.email}</small>}
            </div>

            <div className="field-group">
              <label htmlFor="laundry-service">Laundry Service</label>
              <select id="laundry-service" name="service" value={form.service} onChange={(event) => setForm({ ...form, service: event.target.value })} aria-invalid={Boolean(errors.service)}>
                <option>Wash &amp; Fold</option>
                <option>Dry Cleaning</option>
                <option>Ironing</option>
                <option>Express Laundry</option>
                <option>Bedding &amp; Duvets</option>
                <option>Pickup &amp; Delivery</option>
              </select>
              {errors.service && <small className="field-error">{errors.service}</small>}
            </div>

            <div className="field-group">
              <label htmlFor="laundry-load">Estimated load size</label>
              <div className="quantity-control">
                <input id="laundry-load" name="quantity" type="number" min="1" step="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} aria-invalid={Boolean(errors.quantity)} />
                <select aria-label="Quantity unit" value={form.quantityUnit} onChange={(event) => setForm({ ...form, quantityUnit: event.target.value })}>
                  <option value="bag">Bags</option><option value="item">Items</option><option value="kg">Kilograms</option>
                </select>
              </div>
              {errors.quantity && <small className="field-error">{errors.quantity}</small>}
            </div>

            <div className="field-group">
              <label htmlFor="laundry-date">Preferred pickup date</label>
              <input id="laundry-date" type="date" min={new Date().toISOString().slice(0, 10)} value={form.preferredDate} onChange={(event) => setForm({ ...form, preferredDate: event.target.value })} aria-invalid={Boolean(errors.preferredDate)} />
              {errors.preferredDate && <small className="field-error">{errors.preferredDate}</small>}
            </div>

            <div className="field-group">
              <label htmlFor="laundry-time">Preferred pickup time</label>
              <input id="laundry-time" type="time" value={form.preferredTime} onChange={(event) => setForm({ ...form, preferredTime: event.target.value })} aria-invalid={Boolean(errors.preferredTime)} />
              {errors.preferredTime && <small className="field-error">{errors.preferredTime}</small>}
            </div>

            <div className="field-group wide">
              <label htmlFor="laundry-location">Pickup area</label>
              <input id="laundry-location" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder={settings.locationLabel} />
            </div>

            <div className="field-group wide">
              <label htmlFor="laundry-address">Street / home address</label>
              <input id="laundry-address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Exact pickup address" aria-invalid={Boolean(errors.address)} />
              {errors.address && <small className="field-error">{errors.address}</small>}
            </div>

            <div className="field-group wide">
              <label htmlFor="laundry-exact-location">Exact pickup location</label>
              <input id="laundry-exact-location" value={form.exactLocation} onChange={(event) => setForm({ ...form, exactLocation: event.target.value })} placeholder="Gate, building name, landmark or room number" />
            </div>

            <div className="field-group wide">
              <label htmlFor="laundry-notes">Additional instructions</label>
              <textarea id="laundry-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={4} placeholder="Any special instructions or preferred timing" />
            </div>
          </div>

          <div className="booking-submit-row">
            <button type="submit" className="booking-button" disabled={submitting}>
              {submitting ? <><LoaderCircle size={16} className="spinner" /> Sending request...</> : 'Request Laundry Pickup'}
            </button>
          </div>

          {notice && bookingConfirmation && <div className="booking-message booking-confirmation" role="status" aria-live="polite">
            <span className="status-pill confirmation-status">{statusLabel(bookingConfirmation.status)}</span>
            <strong>Booking {bookingConfirmation.id}</strong>
            <span>{notice}</span>
            <dl>
              <div><dt>Customer</dt><dd>{bookingConfirmation.name}</dd></div>
              <div><dt>Service</dt><dd>{bookingConfirmation.service}</dd></div>
              <div><dt>Pickup</dt><dd>{bookingConfirmation.location}, {bookingConfirmation.address}</dd></div>
              <div><dt>Preferred time</dt><dd>{bookingConfirmation.preferredDate} at {bookingConfirmation.preferredTime}</dd></div>
            </dl>
            {whatsappUrl && <a className="booking-support-link" href={`${whatsappUrl}?text=${encodeURIComponent(`Hello MATRIX Laundry, I need help with booking ${bookingConfirmation.id}.`)}`} target="_blank" rel="noreferrer"><FaWhatsapp size={16} /> Contact support</a>}
            <small>Keep this reference. This request is currently stored in this browser; it has not been sent by email or SMS.</small>
          </div>}
        </form>
      </section>}

      {page === 'track' && <section id="track-booking" className="laundry-section tracking-section">
        <div className="section-heading">
          <div><span className="section-kicker">ORDER STATUS</span><h2>Track a laundry request</h2></div>
        </div>
        <div className="tracking-layout">
          <form className="tracking-form" onSubmit={trackLaundryBooking}>
            <p>Look up the latest status recorded by the laundry team using your booking reference and phone number.</p>
            <div className="field-group"><label htmlFor="tracking-reference">Booking reference</label><input id="tracking-reference" value={trackingReference} onChange={(event) => setTrackingReference(event.target.value)} placeholder="LAUN-..." autoComplete="off" /></div>
            <div className="field-group"><label htmlFor="tracking-phone">Booking phone number</label><input id="tracking-phone" type="tel" inputMode="tel" value={trackingPhone} onChange={(event) => setTrackingPhone(event.target.value)} placeholder="0712 345 678" /></div>
            <button type="submit" className="booking-button">Check status</button>
            <small>Tracking is available only in the browser where the request was made until online laundry booking storage is connected.</small>
            {trackingError && <p className="field-error" role="alert">{trackingError}</p>}
          </form>
          {trackedBooking && <article className="tracking-result" aria-live="polite">
            <span className="status-pill tracking-status">{statusLabel(trackedBooking.status)}</span>
            <h3>{trackedBooking.id}</h3>
            <p>{trackedBooking.service} · {trackedBooking.quantity} {trackedBooking.quantityUnit}</p>
            <p>Pickup: {trackedBooking.preferredDate} at {trackedBooking.preferredTime}</p>
            <ol className="status-timeline">
              {(['new', 'confirmed', 'ready'] as const).map((status) => <li className={(['new', 'confirmed', 'ready'].indexOf(trackedBooking.status) >= ['new', 'confirmed', 'ready'].indexOf(status)) ? 'is-complete' : ''} key={status}><span />{statusLabel(status)}</li>)}
            </ol>
            {whatsappUrl && <a className="booking-support-link" href={`${whatsappUrl}?text=${encodeURIComponent(`Hello MATRIX Laundry, I need an update on booking ${trackedBooking.id}.`)}`} target="_blank" rel="noreferrer"><FaWhatsapp size={16} /> Contact support</a>}
          </article>}
        </div>
      </section>}

      {(page === 'home' || page === 'about') && <section className="laundry-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">WHY CHOOSE US</span>
            <h2>Service built around convenience and care</h2>
          </div>
        </div>

        <div className="benefits-grid">
          {benefits.map(({ title, description, icon: Icon }) => (
            <article className="benefit-card" key={title}>
              <div className="benefit-icon"><Icon size={22} /></div>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
        {page === 'about' && <div className="about-story-grid">
          <article><span className="section-kicker">OUR MISSION</span><h3>Make laundry day feel lighter.</h3><p>We help homes and professionals reclaim time through convenient collection and attentive care for everyday clothing and household essentials.</p></article>
          <article><span className="section-kicker">OUR APPROACH</span><h3>Care, clarity, and dependable service.</h3><p>We listen to your instructions, confirm the pickup plan, and keep communication straightforward from request to return.</p></article>
        </div>}
      </section>}

      {page === 'gallery' && <section className="laundry-section gallery-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">GALLERY</span>
            <h2>Clean, cared-for clothes and spotless essentials</h2>
          </div>
        </div>

        <div className="gallery-grid">
          {gallery.map((image, index) => (
            <figure className="gallery-item" key={image.src + index}>
              <img src={image.src} alt={image.alt} loading="lazy" decoding="async" />
            </figure>
          ))}
        </div>
      </section>}

      {page === 'contact' && <section className="laundry-location-section">
        <div className="location-card">
          <div className="section-heading compact-heading">
            <div>
              <span className="section-kicker">LOCATION & CONTACT</span>
              <h2>Serving {settings.locationLabel}</h2>
            </div>
          </div>

          <div className="location-details">
            <div className="detail-row"><MapPin size={18} /><span>{settings.locationLabel}</span></div>
            {supportPhone && <div className="detail-row"><Phone size={18} /><a href={`tel:${supportPhone}`}>{supportPhone}</a></div>}
            {supportEmail && <div className="detail-row"><Mail size={18} /><a href={`mailto:${supportEmail}`}>{supportEmail}</a></div>}
            {!supportPhone && !supportEmail && !whatsappUrl && <p>Customer support contact details are not yet configured.</p>}
          </div>

          <div className="location-actions">
            <a href={mapUrl} target="_blank" rel="noreferrer" className="primary-action">View location</a>
            {supportPhone && <a href={`tel:${supportPhone}`} className="secondary-action">Call us</a>}
          </div>
        </div>

        <div className="info-card">
          <h3>Pickup coverage</h3>
          <p>Our service is tailored to homes, apartments and businesses in and around {settings.locationLabel}.</p>
          <ul>
            <li>Reliable weekly or on-demand pickup</li>
            <li>Flexible scheduling for busy routines</li>
            <li>Friendly support and clear communication</li>
          </ul>
        </div>
      </section>}

      {page === 'faqs' && <section className="laundry-section faq-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">TRUST & SUPPORT</span>
            <h2>Helpful answers before you book</h2>
          </div>
        </div>

        <div className="faq-grid">
          <details className="faq-card"><summary>How do I schedule a pickup?</summary><p>Fill in the booking form with your service, pickup area and preferred timing. We will confirm the collection details shortly.</p></details>
          <details className="faq-card"><summary>Do you offer flexible timing?</summary><p>Share your preferred date and time in the form to help us plan the pickup around your schedule.</p></details>
          <details className="faq-card"><summary>How do you handle delicate items?</summary><p>Tell us about delicate fabrics or special pieces in your booking instructions so the team can discuss suitable care.</p></details>
          <details className="faq-card"><summary>Where can I see your prices?</summary><p>Rates have not yet been published online. Request a quotation before confirming service.</p><Link to="/laundry/pricing">Pricing &amp; quotations <ArrowRight size={14} /></Link></details>
          <details className="faq-card"><summary>How can I follow my booking?</summary><p>Use your booking reference and booking phone number on the tracking page. Status is shown when the laundry team updates it.</p><Link to="/laundry/track">Track a booking <ArrowRight size={14} /></Link></details>
          <details className="faq-card"><summary>How do I contact support?</summary><p>Call, email or message us using the contact details on our support page.</p><Link to="/laundry/contact">Contact support <ArrowRight size={14} /></Link></details>
        </div>
      </section>}
    </main>

    <footer className="laundry-footer">
      <div className="laundry-footer-brand">
        <Link to="/laundry" className="brand-lockup" aria-label="MATRIX Laundry home">
          <SiteImage slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" />
        </Link>
        <p>Fresh, reliable laundry care for busy households and professionals in Machakos.</p>
      </div>

      <div className="laundry-footer-links">
        <div>
          <h3>Quick links</h3>
          <Link to="/laundry">Home</Link>
          <Link to="/laundry/how-it-works">How it works</Link>
          <Link to="/laundry/faqs">FAQs</Link>
          <Link to="/marketplace#products">Browse listings</Link>
        </div>
        <div>
          <h3>Services</h3>
          <Link to="/laundry/services">All services</Link>
          <Link to="/laundry/pricing">Pricing &amp; quotations</Link>
          <Link to="/laundry/track">Track booking</Link>
        </div>
        <div>
          <h3>Contact</h3>
          {supportPhone && <a href={`tel:${supportPhone}`}>{supportPhone}</a>}
          {supportEmail && <a href={`mailto:${supportEmail}`}>{supportEmail}</a>}
          <span>{settings.locationLabel}</span>
        </div>
      </div>
    </footer>
    {whatsappUrl && <a className="laundry-whatsapp-float" href={`${whatsappUrl}?text=${encodeURIComponent('Hello MATRIX Laundry, I have a question about your laundry service.')}`} target="_blank" rel="noreferrer" aria-label="Contact MATRIX Laundry on WhatsApp"><FaWhatsapp size={22} /><span>Chat with us</span></a>}
  </main>
}

function LaundryHomePage() { return <LaundryPage page="home" /> }
function LaundryServicesPage() { return <LaundryPage page="services" /> }
function LaundryPricingPage() { return <LaundryPage page="pricing" /> }
function LaundryBookingPage() { return <LaundryPage page="book" /> }
function LaundryTrackingPage() { return <LaundryPage page="track" /> }
function LaundryHowItWorksPage() { return <LaundryPage page="how-it-works" /> }
function LaundryGalleryPage() { return <LaundryPage page="gallery" /> }
function LaundryAboutPage() { return <LaundryPage page="about" /> }
function LaundryContactPage() { return <LaundryPage page="contact" /> }
function LaundryFaqsPage() { return <LaundryPage page="faqs" /> }

function LaundryNotFoundPage() {
  useEffect(() => { document.title = 'Page Not Found | MATRIX Laundry' }, [])
  return <main className="laundry-page-shell laundry-not-found"><SiteImage slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" /><span className="section-kicker">MATRIX LAUNDRY</span><h1>We could not find that page.</h1><p>The page may have moved. Choose a section to continue.</p><Link className="primary-action" to="/laundry">Back to laundry home</Link></main>
}

function LaundryAdminPage() {
  const [settings, setSettings] = useState<LaundryPageSettings>(() => readStoredValue(laundrySettingsStorageKey, defaultLaundrySettings))
  const [bookings, setBookings] = useState<LaundryBooking[]>(() => readStoredValue(laundryBookingsStorageKey, []))
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setSettings(readStoredValue(laundrySettingsStorageKey, defaultLaundrySettings))
    setBookings(readStoredValue(laundryBookingsStorageKey, []))
  }, [])

  const updateSetting = <K extends keyof LaundryPageSettings>(key: K, value: LaundryPageSettings[K]) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    writeStoredValue(laundrySettingsStorageKey, next)
  }

  const saveSettings = () => {
    writeStoredValue(laundrySettingsStorageKey, settings)
    setNotice('Laundry page updated successfully.')
  }

  const toggleStatus = (bookingId: string) => {
    const next: LaundryBooking[] = bookings.map((booking) => {
      if (booking.id !== bookingId) return booking
      const status: LaundryBooking['status'] = booking.status === 'new' ? 'confirmed' : booking.status === 'confirmed' ? 'ready' : 'new'
      return { ...booking, status }
    })
    setBookings(next)
    writeStoredValue(laundryBookingsStorageKey, next)
  }

  return <main className="laundry-admin-shell">
    <header className="admin-topbar laundry-admin-header"><div><span className="admin-kicker">LAUNDRY ADMIN</span><h1>Service management</h1></div><Link to="/laundry" className="laundry-preview-link">Preview page</Link></header>

    <section className="laundry-admin-grid">
      <div className="admin-panel laundry-edit-panel">
        <header><h2>Page content</h2></header>
        <div className="laundry-form-grid">
          <label><span>Page title</span><input value={settings.title} onChange={(event) => updateSetting('title', event.target.value)} /></label>
          <label><span>Subtitle</span><input value={settings.subtitle} onChange={(event) => updateSetting('subtitle', event.target.value)} /></label>
          <label className="full-width"><span>Page description</span><textarea value={settings.description} onChange={(event) => updateSetting('description', event.target.value)} rows={4} /></label>
          <label className="full-width"><span>Hero photo URL</span><input value={settings.heroImage} onChange={(event) => updateSetting('heroImage', event.target.value)} /></label>
          <label><span>Service location</span><input value={settings.locationLabel} onChange={(event) => updateSetting('locationLabel', event.target.value)} /></label>
          <label><span>Map query</span><input value={settings.locationQuery} onChange={(event) => updateSetting('locationQuery', event.target.value)} /></label>
          <label><span>Phone</span><input value={settings.phone} onChange={(event) => updateSetting('phone', event.target.value)} /></label>
          <label><span>Email</span><input value={settings.email} onChange={(event) => updateSetting('email', event.target.value)} /></label>
        </div>
        <button type="button" className="laundry-admin-save" onClick={saveSettings}>Save page content</button>
        {notice && <p className="laundry-notice">{notice}</p>}
      </div>

      <div className="admin-panel laundry-bookings-panel">
        <header><h2>Pickup bookings</h2></header>
        <div className="laundry-bookings-list">
          {bookings.length === 0 ? <p className="empty-state">No pickup requests yet.</p> : bookings.map((booking) => <article key={booking.id} className="laundry-booking-item">
            <div className="laundry-booking-header">
              <strong>{booking.name}</strong>
              <span className={`booking-status ${booking.status}`}>{booking.status}</span>
            </div>
            <p><Mail size={12} /> {booking.email}</p>
            <p><Phone size={12} /> {booking.phone}</p>
            <p><MapPin size={12} /> {booking.location}</p>
            <p><strong>Address:</strong> {booking.address || 'Not provided'}</p>
            <p><strong>Service:</strong> {booking.service}</p>
            <p><strong>Quantity:</strong> {booking.quantity ?? 1} {booking.quantityUnit ?? 'bag'}</p>
            <p><strong>Preferred pickup:</strong> {booking.preferredDate || 'Not specified'} {booking.preferredTime ? `at ${booking.preferredTime}` : ''}</p>
            <p><strong>Notes:</strong> {booking.notes || 'No notes'}</p>
            <div className="booking-actions"><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.location || settings.locationQuery)}`} target="_blank" rel="noreferrer">View location</a><button type="button" onClick={() => toggleStatus(booking.id)}>{booking.status === 'ready' ? 'Reset status' : 'Mark ready'}</button></div>
          </article>)}
        </div>
      </div>
    </section>
  </main>
}

function MarketplaceProductPage() {
  const { slug = '' } = useParams()
  const [searchParams] = useSearchParams()
  const whatsappIntent = searchParams.get('intent') === 'whatsapp'
  const [listing, setListing] = useState<(Listing & { images: string[]; contactUnlockFeeKes: number }) | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedImage, setSelectedImage] = useState(0)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [contact, setContact] = useState<{ name: string; phone: string; whatsapp: string | null; email: string | null } | null>(null)
  const [unlockToken, setUnlockToken] = useState(() => sessionStorage.getItem(`mh_unlock_token_${slug}`) ?? '')
  const [unlockMessage, setUnlockMessage] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [paymentPanelOpen, setPaymentPanelOpen] = useState(whatsappIntent)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportMessage, setReportMessage] = useState('')
  const sellerWhatsAppNumber = contact ? normalizeWhatsAppNumber(contact.whatsapp || contact.phone) : null
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    marketplaceFetch(`/api/v1/marketplace/products/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { data?: Listing & { images: string[]; contactUnlockFeeKes: number }; error?: { message?: string } }
        if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'This listing is unavailable.')
        setListing(result.data)
        setSelectedImage(0)
        void marketplaceFetch(`/api/v1/marketplace/products/${encodeURIComponent(slug)}/views`, { method: 'POST', signal: controller.signal }).catch(() => undefined)
        const savedToken = sessionStorage.getItem(`mh_unlock_token_${slug}`)
        if (savedToken) {
          setUnlockToken(savedToken)
          const contactResponse = await marketplaceFetch(`/api/v1/marketplace/payments/products/${encodeURIComponent(slug)}/contact`, { method: 'POST', headers: { 'X-Unlock-Token': savedToken }, signal: controller.signal })
          if (contactResponse.ok) {
            const contactResult = await contactResponse.json() as { data: { name: string; phone: string; whatsapp: string | null; email: string | null } }
            setContact(contactResult.data)
          }
        }
      })
      .catch(() => { if (!controller.signal.aborted) setError('This listing is unavailable.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [slug])

  async function unlockSellerContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!listing) return
    setUnlocking(true)
    setUnlockMessage('')
    try {
      const response = await marketplaceFetch('/api/v1/marketplace/payments/contact-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name, phone, email }),
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
        const statusResponse = await marketplaceFetch(`/api/v1/marketplace/payments/${paymentReference}/status`, { headers: { 'X-Payment-Token': accessToken } })
        const statusResult = await statusResponse.json() as { data?: { status: string }; error?: { message?: string } }
        if (!statusResponse.ok || !statusResult.data) throw new Error(statusResult.error?.message ?? 'Payment status could not be checked.')
        if (statusResult.data.status === 'succeeded') {
          const contactResponse = await marketplaceFetch(`/api/v1/marketplace/payments/products/${encodeURIComponent(slug)}/contact`, { method: 'POST', headers: { 'X-Unlock-Token': accessToken } })
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
    } catch {
      setUnlockMessage('Contact unlock could not be completed. Please try again.')
    } finally {
      setUnlocking(false)
    }
  }

  async function checkExistingUnlock() {
    const paymentReference = sessionStorage.getItem(`mh_unlock_payment_${slug}`)
    if (!unlockToken || !paymentReference) return
    setUnlocking(true)
    try {
      const response = await marketplaceFetch(`/api/v1/marketplace/payments/${paymentReference}/status`, { headers: { 'X-Payment-Token': unlockToken } })
      const result = await response.json() as { data?: { status: string }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Payment status could not be checked.')
      if (result.data.status !== 'succeeded') {
        setUnlockMessage('Payment is still being verified.')
        return
      }
      const contactResponse = await marketplaceFetch(`/api/v1/marketplace/payments/products/${encodeURIComponent(slug)}/contact`, { method: 'POST', headers: { 'X-Unlock-Token': unlockToken } })
      const contactResult = await contactResponse.json() as { data?: { name: string; phone: string; whatsapp: string | null; email: string | null }; error?: { message?: string } }
      if (!contactResponse.ok || !contactResult.data) throw new Error(contactResult.error?.message ?? 'Verified contact could not be retrieved.')
      setContact(contactResult.data)
      setUnlockMessage('Payment verified. WhatsApp is ready.')
      setPaymentPanelOpen(false)
    } catch {
      setUnlockMessage('Payment status could not be checked. Please try again.')
    } finally {
      setUnlocking(false)
    }
  }

  async function reportListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setReportMessage('')
    try {
      const response = await marketplaceFetch(`/api/v1/marketplace/products/${encodeURIComponent(slug)}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: formData.get('reason'), details: formData.get('details'), email: formData.get('email') }),
      })
      const result = await response.json() as { data?: { reportReference: string }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'The report could not be sent.')
      setReportMessage('Thanks. The marketplace support team will review this listing.')
      setReportOpen(false)
    } catch {
      setReportMessage('The report could not be sent. Please try again.')
    }
  }

  const productHeader = <header>
    <Link className="market-brand" to="/marketplace" aria-label="MATRIX marketplace"><SiteImage slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" /></Link>
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
              {sellerWhatsAppNumber && <a className="whatsapp-contact-button" href={`https://wa.me/${sellerWhatsAppNumber}`} target="_blank" rel="noreferrer"><FaWhatsapp size={17} /> Proceed to WhatsApp</a>}
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
                {unlocking ? <div className="payment-waiting" role="status" aria-live="polite"><LoaderCircle size={28} aria-hidden="true" /><strong>Waiting for M-PESA confirmation</strong><span>Approve the prompt on your phone. MarketHub is verifying the payment securely.</span></div> : <form className="unlock-form" onSubmit={unlockSellerContact}>
                  <label>Your full name<input required autoComplete="name" minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
                  <label>M-Pesa phone number<input required inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0712 345 678" /></label>
                  <label>Email for payment confirmation<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                  <button className="pay-button" type="submit">Pay {formatKes(listing.contactUnlockFeeKes)} with M-Pesa</button>
                  {unlockMessage && <p className="payment-message" role="status">{unlockMessage}</p>}
                </form>}
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

function MatrixIntro({ exiting }: { exiting: boolean }) {
  return <div className={`matrix-intro${exiting ? ' is-exiting' : ''}`} role="dialog" aria-modal="true" aria-label="MATRIX introduction">
    <div className="matrix-intro-content">
      <span className="matrix-intro-eyebrow">KITCULTURE + MATRIX</span>
      <div className="matrix-intro-logo-wrap">
        <SiteImage className="matrix-intro-monogram" slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="" aria-hidden="true" />
        <SiteImage className="matrix-intro-full-logo" slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" />
      </div>
      <p className="matrix-intro-tagline">Shop <i /> Connect <i /> Trade</p>
      <div className="matrix-intro-statement">
        <h1>ONE DESTINATION. TWO WORLDS.</h1>
        <p>Discover football culture and second-hand finds with Matrix.</p>
      </div>
    </div>
  </div>
}

function LandingPage() {
  const siteContent = usePlatformSiteContent()
  const [footerSocial, setFooterSocial] = useState<FooterSocialLinks>({ facebookUrl: null, xUrl: null, youtubeUrl: null, whatsappUrl: null, whatsappPhone: null, contactEmail: null, contactPhone: null })
  const publicFooterSocial = resolveFooterSocial(siteContent, footerSocial)
  const [introActive, setIntroActive] = useState(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    try { return window.sessionStorage.getItem(matrixIntroStorageKey) !== 'true' } catch { return false }
  })
  const [introExiting, setIntroExiting] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    marketplaceFetch('/api/v1/marketplace/settings/footer-social-links', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return
        const result = await response.json() as { data?: FooterSocialLinks }
        if (result.data) setFooterSocial(result.data)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!introActive) return
    try { window.sessionStorage.setItem(matrixIntroStorageKey, 'true') } catch { /* session storage is optional */ }
    setIntroExiting(false)
    const duration = 5999
    const exitTimer = window.setTimeout(() => setIntroExiting(true), duration - 550)
    const finishTimer = window.setTimeout(() => setIntroActive(false), duration)
    return () => {
      window.clearTimeout(exitTimer)
      window.clearTimeout(finishTimer)
    }
  }, [introActive])

  return <div className="platform-shell landing-shell">
    <header className="platform-header" inert={introActive} aria-hidden={introActive}>
      <Link to="/" className="brand-lockup" aria-label="MATRIX home">
        <SiteImage slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" />
      </Link>
      <nav className="landing-nav" aria-label="Main navigation">
        <a className="nav-current" href="#home"><House size={15} />Home</a>
        <a href="#about"><CircleHelp size={15} />About</a>
        <a href={publicFooterSocial.contactEmail ? `mailto:${publicFooterSocial.contactEmail}` : '#about'}><Compass size={15} />Contact</a>
        <Link className="nav-cta" to="/marketplace">Get Started <ArrowRight size={15} /></Link>
      </nav>
    </header>

    <main id="home" className="landing-main" inert={introActive} aria-hidden={introActive}>
      <div className="landscape-backdrop" aria-hidden="true" />
      <section className="landing-intro" aria-labelledby="landing-title">
        <p className="intro-kicker">YOUR NEXT GREAT FIND STARTS HERE</p>
        <h1 id="landing-title">Everything You Need.<br /><span>One Destination.</span></h1>
        <p className="landing-subtitle"><i />Choose your shopping experience and explore more possibilities.<i /></p>
      </section>

      <section className="destination-grid" aria-label="Choose a website">
        <article className="destination-card kits-card">
          <SiteImage slot="platform-kits-card" fallback="/images/the%20kits.png" alt="Football shirts in a stadium under match lights" loading="eager" decoding="async" fetchPriority="high" width="640" height="480" />
          <div className="card-shade" />
          <div className="destination-content">
            <span className="destination-tag"><span className="football-mark">●</span> Football Kits</span>
            <h2>Selling<br /><em>Kits</em></h2>
            <p>Discover football jerseys, club collections and your favourite kits.</p>
            <a className="destination-button orange-button" href="/kits">
              Explore Selling Kits <ArrowRight size={17} />
            </a>
          </div>
          <span className="card-index">01 / 03</span>
        </article>

        <article className="destination-card market-card">
          <SiteImage slot="platform-marketplace-card" fallback="/images/second%20hand.png" alt="A collection of second-hand products for sale" loading="eager" decoding="async" fetchPriority="high" width="640" height="480" />
          <div className="card-shade" />
          <div className="destination-content">
            <span className="destination-tag"><ShoppingBag size={14} /> Second-Hand</span>
            <h2>Second-Hand<br /><em>Marketplace</em></h2>
            <p>Discover, advertise and connect with buyers and sellers of pre-loved finds.</p>
            <Link className="destination-button green-button" to="/marketplace">
              Explore Marketplace <ArrowRight size={17} />
            </Link>
          </div>
          <span className="card-index">02 / 03</span>
        </article>

        <article className="destination-card laundry-card">
          <img src="/images/laundry-wash-fold.jpg" alt="A clean laundry with professional washing machines" loading="eager" decoding="async" fetchPriority="high" width="640" height="480" />
          <div className="card-shade laundry-card-shade" />
          <div className="destination-content">
            <span className="destination-tag"><Sparkles size={14} /> Laundry</span>
            <h2>Laundry &amp;<br /><em>Dry Cleaning</em></h2>
            <p>Book pickup, washing, ironing and reliable delivery for everyday essentials.</p>
            <Link className="destination-button purple-button" to="/laundry">
              Book Laundry <ArrowRight size={17} />
            </Link>
          </div>
          <span className="card-index">03 / 03</span>
        </article>
      </section>

      <section className="trust-strip" aria-label="Marketplace values">
        <div><ShieldCheck /><span><strong>Secure &amp; Trusted</strong><small>Shop with confidence</small></span></div>
        <div><Zap /><span><strong>Fast &amp; Easy</strong><small>Find what you need</small></span></div>
        <div><MapPin /><span><strong>Local Focus</strong><small>Machakos and beyond</small></span></div>
        <div><BadgeCheck /><span><strong>Connect Directly</strong><small>Buy and sell with ease</small></span></div>
      </section>
    </main>

    <footer id="about" className="landing-footer" inert={introActive} aria-hidden={introActive}>
      <Link to="/" className="footer-brand" aria-label="MATRIX home"><SiteImage slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" /></Link>
      <p><i />Two Amazing Shopping Experiences.<br />One Powerful Platform.<i /></p>
      <div className="footer-right">
        <div className="footer-contact-links">{publicFooterSocial.contactEmail && <a href={`mailto:${publicFooterSocial.contactEmail}`}><Mail size={14} />{publicFooterSocial.contactEmail}</a>}{publicFooterSocial.contactPhone && <a href={`tel:${publicFooterSocial.contactPhone}`}><Phone size={14} />{publicFooterSocial.contactPhone}</a>}</div>
        <div className="footer-social" role="group" aria-label="MATRIX social networks">
          {publicFooterSocial.facebookUrl ? <a className="social-facebook" href={publicFooterSocial.facebookUrl} target="_blank" rel="noreferrer" aria-label="MATRIX on Facebook"><FaFacebookF /></a> : <span className="social-facebook" role="img" aria-label="Facebook link not configured"><FaFacebookF /></span>}
          {publicFooterSocial.xUrl ? <a className="social-x" href={publicFooterSocial.xUrl} target="_blank" rel="noreferrer" aria-label="MATRIX on X"><FaXTwitter /></a> : <span className="social-x" role="img" aria-label="X link not configured"><FaXTwitter /></span>}
          {publicFooterSocial.youtubeUrl ? <a className="social-youtube" href={publicFooterSocial.youtubeUrl} target="_blank" rel="noreferrer" aria-label="MATRIX on YouTube"><FaYoutube /></a> : <span className="social-youtube" role="img" aria-label="YouTube link not configured"><FaYoutube /></span>}
          {publicFooterSocial.whatsappUrl ? <a className="social-whatsapp" href={publicFooterSocial.whatsappUrl} target="_blank" rel="noreferrer" aria-label="Message MATRIX on WhatsApp"><FaWhatsapp /></a> : <span className="social-whatsapp" role="img" aria-label="Kenyan WhatsApp number not configured"><FaWhatsapp /></span>}
        </div>
        <span className="footer-divider" aria-hidden="true" />
        <div className="footer-meta"><img className="kenya-flag" src="/images/kenya-flag.svg" alt="Flag of Kenya" /><span>Kenya</span></div>
      </div>
    </footer>
    {introActive && <MatrixIntro exiting={introExiting} />}
  </div>
}

function MarketplaceHome() {
  const siteContent = usePlatformSiteContent()
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('q') ?? ''
  const category = searchParams.get('category') ?? ''
  const requestedPage = Number(searchParams.get('page') ?? '1')
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const [categories, setCategories] = useState<MarketplaceCategory[]>([])
  const [counties, setCounties] = useState<MarketplaceCounty[]>([])
  const [footerSocial, setFooterSocial] = useState<FooterSocialLinks>({ facebookUrl: null, xUrl: null, youtubeUrl: null, whatsappUrl: null, whatsappPhone: null, contactEmail: null, contactPhone: null })
  const publicFooterSocial = resolveFooterSocial(siteContent, footerSocial)
  const [categoryError, setCategoryError] = useState('')
  const [categoryRetry, setCategoryRetry] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [searchDraft, setSearchDraft] = useState({ query: search, value: search })
  const searchText = searchDraft.query === search ? searchDraft.value : search
  useEffect(() => {
    const controller = new AbortController()
    marketplaceFetch('/api/v1/marketplace/settings/footer-social-links', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return
        const result = await response.json() as { data?: FooterSocialLinks }
        if (result.data) setFooterSocial(result.data)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])
  const filters: CatalogueFilters = {
    county: searchParams.get('county') ?? '',
    subcategory: searchParams.get('subcategory') ?? '',
    subcounty: searchParams.get('subcounty') ?? '',
    town: searchParams.get('town') ?? '',
    condition: searchParams.get('condition') ?? '',
    minPrice: searchParams.get('minPrice') ?? '',
    maxPrice: searchParams.get('maxPrice') ?? '',
    publishedAfter: searchParams.get('publishedAfter') ?? '',
    publishedBefore: searchParams.get('publishedBefore') ?? '',
    negotiable: searchParams.get('negotiable') ?? '',
    sort: searchParams.get('sort') ?? 'newest',
    featured: searchParams.get('featured') ?? 'all',
  }
  const filterQuery = new URLSearchParams(Object.entries(filters).filter(([key, value]) => value !== '' && (value !== 'false' || key === 'featured'))).toString()
  useEffect(() => {
    const controller = new AbortController()
    marketplaceFetch('/api/v1/marketplace/categories', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { data?: MarketplaceCategory[]; error?: { message?: string } }
        if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Categories could not be loaded.')
        setCategories(result.data)
      })
      .catch(() => { if (!controller.signal.aborted) setCategoryError('Categories could not be loaded.') })
    return () => controller.abort()
  }, [categoryRetry])
  useEffect(() => {
    const controller = new AbortController()
    marketplaceFetch('/api/v1/marketplace/locations/counties', { signal: controller.signal })
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
  useEffect(() => {
    if (searchText.trim() === search) return
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams)
      const value = searchText.trim()
      if (value) next.set('q', value)
      else next.delete('q')
      next.delete('page')
      setSearchParams(next, { replace: true })
    }, 220)
    return () => window.clearTimeout(timer)
  }, [searchText, search, searchParams, setSearchParams])
  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const values = Object.fromEntries(['county', 'subcounty', 'town', 'condition', 'minPrice', 'maxPrice', 'publishedAfter', 'publishedBefore', 'negotiable', 'sort'].map((key) => [key, String(formData.get(key) ?? '')]))
    values.featured = formData.has('featuredOnly') ? 'true' : searchParams.get('featured') === 'false' ? 'false' : 'all'
    setQuery(values)
  }
  return <div className="marketplace-shell">
    <header className="marketplace-header">
      <Link to="/" className="market-brand" aria-label="MATRIX home"><SiteImage slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" /></Link>
      <nav aria-label="Marketplace navigation"><Link className="market-home" to="/marketplace#top"><House size={15} />Home</Link><Link to="/marketplace?featured=all#products" aria-current={!search && filters.featured === 'all' ? 'page' : undefined}>All Products</Link><Link to="/marketplace?featured=false&sort=newest#products" aria-current={filters.featured === 'false' ? 'page' : undefined}>Recently Published</Link><Link to="/marketplace?featured=true#products" aria-current={filters.featured === 'true' ? 'page' : undefined}>Featured</Link></nav>
      <div className="market-actions"><ThemeToggle /><Link className="sell-link" to="/marketplace/seller/login">+ <span>Sell item</span></Link></div>
    </header>
    <main>
      <section className="market-hero" id="top">
        <div className="market-hero-photo" aria-hidden="true" />
        <div className="market-hero-copy">
          <span className="hero-eyebrow"><Sparkles size={14} /> MACHAKOS FINDS, BETTER DAYS</span>
          <h1>Second-Hand<br /><em>Marketplace</em></h1>
          <p>Discover, advertise and connect with buyers and sellers of quality second-hand products.</p>
          <form className="market-search" onSubmit={submitSearch}><label className="sr-only" htmlFor="market-search-input">Search products</label><Search size={18} /><input id="market-search-input" value={searchText} onChange={(event) => setSearchDraft({ query: search, value: event.target.value })} placeholder="Search for products..." /><button type="submit">Search</button></form>
        </div>
        <div className="hero-burst">Great<br />Deals!</div>
      </section>
      <section id="categories" className="category-select-section" aria-label="Browse categories">
        <label htmlFor="market-category">Category</label>
        <select id="market-category" value={category || (filters.subcategory ? `subcategory:${filters.subcategory}` : '')} onChange={(event) => {
          const value = event.target.value
          const isSubcategory = value.startsWith('subcategory:')
          setQuery({ category: isSubcategory ? '' : value, subcategory: isSubcategory ? value.slice('subcategory:'.length) : '' })
        }}>
          <option value="">All categories</option>
          {categories.map((item) => <optgroup key={item.id} label={item.name}>
            <option value={item.slug}>{item.name}</option>
            {item.subcategories?.map((subcategory) => <option key={subcategory.id} value={`subcategory:${subcategory.slug}`}>{subcategory.name}</option>)}
          </optgroup>)}
        </select>
        {categoryError && <button type="button" onClick={() => setCategoryRetry((value) => value + 1)}>Reload categories</button>}
      </section>

      <section className="market-content">
        <div className="listing-area" id="products">
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
    <footer className="market-footer"><Link to="/" className="market-footer-brand" aria-label="MATRIX home"><SiteImage slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" /></Link><span className="market-footer-links"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link>{publicFooterSocial.contactEmail && <a href={`mailto:${publicFooterSocial.contactEmail}`}><Mail size={14} /> Email</a>}{publicFooterSocial.contactPhone && <a href={`tel:${publicFooterSocial.contactPhone}`}><Phone size={14} /> {publicFooterSocial.contactPhone}</a>}</span><span className="market-footer-social" aria-label="MarketHub social accounts">{publicFooterSocial.facebookUrl && <a href={publicFooterSocial.facebookUrl} target="_blank" rel="noreferrer" aria-label="Facebook"><FaFacebookF /></a>}{publicFooterSocial.xUrl && <a href={publicFooterSocial.xUrl} target="_blank" rel="noreferrer" aria-label="X"><FaXTwitter /></a>}{publicFooterSocial.youtubeUrl && <a href={publicFooterSocial.youtubeUrl} target="_blank" rel="noreferrer" aria-label="YouTube"><FaYoutube /></a>}{publicFooterSocial.whatsappUrl && <a href={publicFooterSocial.whatsappUrl} target="_blank" rel="noreferrer" aria-label="WhatsApp"><FaWhatsapp /></a>}</span><small><SiteContentValue field="platformFooterNotice" fallback={`© ${new Date().getFullYear()} MarketHub Kenya`} /></small></footer>
  </div>
}

function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const isTerms = kind === 'terms'
  return <main className="marketplace-shell legal-page">
    <header className="marketplace-header"><Link to="/marketplace" className="market-brand" aria-label="MATRIX marketplace"><SiteImage slot="platform-brand-logo" fallback="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" /></Link><Link to="/marketplace">Back to marketplace</Link></header>
    <article>
      <p className="hero-eyebrow">MARKETHUB KENYA</p>
      <h1>{isTerms ? 'Terms & Conditions' : 'Privacy Statement'}</h1>
      <p className="legal-updated">Last updated: 8 November 2026</p>
      {isTerms ? <SiteContentParagraphs field="terms" fallback={<>
        <p>These terms apply when you browse MarketHub, publish a listing, contact a seller, or use a MarketHub account. By using the service, you agree to these terms. If you do not agree, please do not use the service.</p>
        <h2>How MarketHub works</h2>
        <p>MarketHub helps people in Kenya discover second-hand goods and connect with sellers. Sellers create listings; buyers decide whether to contact a seller and arrange a transaction. Unless we expressly say otherwise, MarketHub is not the seller, buyer, owner, or delivery provider for listed goods. Buyers and sellers are responsible for checking goods, agreeing on price and delivery, and completing their transaction safely.</p>
        <h2>Accounts and listings</h2>
        <p>Provide accurate account and listing information, keep your sign-in details secure, and promptly correct information that changes. You must be legally able to use the service. You are responsible for the content you submit and must have the rights needed to publish your text and images.</p>
        <p>Listings must be lawful, truthful, and for goods you are entitled to sell. Do not list stolen, counterfeit, unsafe, restricted, or otherwise unlawful goods; impersonate another person; post misleading information; or misuse another person’s personal information. MarketHub may edit, limit, decline, or remove content and may restrict accounts when reasonably needed to protect users or comply with law.</p>
        <h2>Fees and contacting sellers</h2>
        <p>Any applicable listing or contact fee will be shown before you confirm the relevant action. Contact details made available through a paid contact feature are for discussing the associated listing. Do not misuse those details, send unsolicited bulk messages, or share them without permission. A payment for access to contact information does not guarantee a response, sale, product quality, or delivery.</p>
        <h2>Safe transactions and reports</h2>
        <p>Verify an item and seller before paying, meet in a safe place where practical, and use your own judgment when arranging delivery. Report suspected fraud, prohibited goods, or misleading listings through the listing report control or by contacting us. We may review reports but cannot guarantee that every listing or user has been independently verified.</p>
        <h2>Availability and changes</h2>
        <p>We work to keep MarketHub available, but features may occasionally be interrupted or changed. Listings may be hidden or removed, and the period a listing remains visible may vary. We may update these terms by posting a revised version here. Continued use after an update means you accept the revised terms.</p>
        <h2>Contact</h2>
        <p>Questions about these terms can be sent to <a href="mailto:hello@markethub.co.ke">hello@markethub.co.ke</a>.</p>
      </>} /> : <SiteContentParagraphs field="privacy" fallback={<>
        <p>This statement explains what information MarketHub Kenya collects when you browse, create an account, publish or respond to a listing, make a payment, or contact us.</p>
        <h2>Information you provide</h2>
        <p>Depending on how you use MarketHub, this may include your name, email address, phone or WhatsApp number, general location, account details, listing descriptions and images, messages or reports you submit, and information needed to verify or support a payment.</p>
        <h2>Information shown to other users</h2>
        <p>Published listings can show the item details, images, price, and general location supplied by the seller. Seller contact details are provided only through the contact feature when its stated requirements have been met. Do not include private or sensitive information in a public listing.</p>
        <h2>How information is used</h2>
        <p>We use information to operate accounts and listings, help buyers and sellers connect, process and confirm requested payments, respond to questions and reports, prevent fraud and abuse, protect the service, and meet legal obligations. Essential browser storage may be used to keep sign-in or a requested contact-access flow working.</p>
        <h2>When information is shared</h2>
        <p>Information may be shared with the other party when you use a marketplace feature that connects you, with payment and communications providers needed to deliver a requested service, with service providers that help operate and protect MarketHub, or when disclosure is required by law. We do not publish buyer payment details as part of a listing.</p>
        <h2>Storage and protection</h2>
        <p>We use reasonable measures to protect personal information. No online service can promise absolute security. We keep information for as long as it is needed for the purposes described here, to resolve issues, and to meet applicable legal requirements, then delete or de-identify it where appropriate.</p>
        <h2>Your choices and requests</h2>
        <p>You may ask to access or correct personal information associated with you, or raise a privacy concern, by emailing <a href="mailto:hello@markethub.co.ke">hello@markethub.co.ke</a>. We may need to verify your identity before acting on a request. Some information may need to be retained where the law requires it or where it is necessary to resolve a transaction or dispute.</p>
        <h2>Changes and contact</h2>
        <p>We may update this statement as our practices or legal obligations change. The latest version will be posted on this page. For privacy questions, contact <a href="mailto:hello@markethub.co.ke">hello@markethub.co.ke</a>.</p>
      </>} />}
      <Link className="legal-back" to="/marketplace">Return to MarketHub</Link>
    </article>
  </main>
}

function ServiceUnavailablePage() {
  return <main className="service-error-page"><ShoppingBag size={30} aria-hidden="true" /><h1>Error 503</h1><p>MarketHub is temporarily unavailable. Please try again later.</p><Link to="/marketplace">Return to MarketHub</Link></main>
}

function KitsRedirect() {
  useEffect(() => { window.location.replace(kitzOrigin) }, [])
  return <p className="redirect-message">Opening Selling Kits…</p>
}

export function App() {
  const navigate = useNavigate()
  useEffect(() => {
    const handleUnavailable = () => navigate('/error-503', { replace: true })
    window.addEventListener(marketplaceUnavailableEvent, handleUnavailable)
    return () => window.removeEventListener(marketplaceUnavailableEvent, handleUnavailable)
  }, [navigate])
  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/kits/*" element={<KitsRedirect />} />
    <Route path="/marketplace" element={<MarketplaceHome />} />
    <Route path="/laundry" element={<LaundryHomePage />} />
    <Route path="/laundry/services" element={<LaundryServicesPage />} />
    <Route path="/laundry/pricing" element={<LaundryPricingPage />} />
    <Route path="/laundry/book" element={<LaundryBookingPage />} />
    <Route path="/laundry/track" element={<LaundryTrackingPage />} />
    <Route path="/laundry/how-it-works" element={<LaundryHowItWorksPage />} />
    <Route path="/laundry/gallery" element={<LaundryGalleryPage />} />
    <Route path="/laundry/about" element={<LaundryAboutPage />} />
    <Route path="/laundry/contact" element={<LaundryContactPage />} />
    <Route path="/laundry/faqs" element={<LaundryFaqsPage />} />
    <Route path="/laundry/*" element={<LaundryNotFoundPage />} />
    <Route path="/admin/laundry" element={<LaundryAdminPage />} />
    <Route path="/marketplace/sell" element={<SellListingPage />} />
    <Route path="/marketplace/seller/signup" element={<SellerSignupPage />} />
    <Route path="/marketplace/seller/login" element={<SellerLoginPage />} />
    <Route path="/marketplace/seller/forgot-password" element={<SellerForgotPasswordPage />} />
    <Route path="/marketplace/seller/reset-password" element={<SellerResetPasswordPage />} />
    <Route path="/marketplace/seller/verify" element={<SellerVerifyPage />} />
    <Route path="/marketplace/seller" element={<SellerPortalPage />} />
    <Route path="/marketplace/status" element={<SubmissionStatusPage />} />
    <Route path="/marketplace/products/:slug" element={<MarketplaceProductPage />} />
    <Route path="/terms" element={<LegalPage kind="terms" />} />
    <Route path="/privacy" element={<LegalPage kind="privacy" />} />
    <Route path="/error-503" element={<ServiceUnavailablePage />} />
    <Route path="/admin/marketplace/login" element={<MarketplaceAdminPage />} />
    <Route path="/admin/marketplace/activate" element={<MarketplaceAdminPage />} />
    <Route path="/admin/marketplace/verify" element={<MarketplaceAdminPage />} />
    <Route path="/admin/marketplace/dashboard" element={<MarketplaceAdminPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}