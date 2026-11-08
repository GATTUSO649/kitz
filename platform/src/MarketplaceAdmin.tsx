import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Activity, ArrowRight, BadgeDollarSign, Box, Check, ChevronDown, CircleAlert, CreditCard, Eye, EyeOff, LayoutDashboard, LockKeyhole, LogOut, Mail, MapPin, Plus, Search, Settings, ShieldCheck, Tag, Tags } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { marketplaceFetch } from './api'

type AdminUser = { id: string; email: string; role: string; permissions: string[] }
type Listing = { reference: string; title: string; status: string; priceKes: number; category: string; county: string; town: string }
type MarketplaceSellerAccount = { id: string; email: string; status: 'pending' | 'active' | 'suspended'; emailVerifiedAt: string | null; createdAt: string; sellerName: string | null; town: string | null; county: string | null }
type Category = { id: string; name: string; slug: string; active: boolean; sortOrder: number }
type Payment = { reference: string; transactionId: string; merchantRequestId: string; checkoutRequestId: string | null; purpose: string; amountKes: number; currency: string; status: string; phone: string; createdAt: string; updatedAt: string; stkPushSubmittedAt: string | null; stkPushResponseAt: string | null; callbackReceivedAt: string | null; verificationCompletedAt: string | null; finalizedAt: string | null; providerResponseCode: string | null; providerResponseDescription: string | null; failureCategory: string | null; failureReason: string | null; providerReceipt: string | null; transactionAt: string | null; verifiedAt: string | null; listingReference: string | null }
type PaymentPagination = { page: number; limit: number; total: number; hasMore: boolean }
type BuyerRecord = { phone: string; email: string | null; lastPaymentAt: string | null; unlockCount: number }
type ActivityRecord = { id: string; action: string; resourceType: string; resourceId: string | null; adminEmail: string | null; createdAt: string }
type NotificationRecord = { id: string; kind: string; status: string; providerReference: string | null; sellerName: string | null; createdAt: string; sentAt: string | null }
type EmailRecord = { id: string; eventKey: string; kind: string; recipientEmail: string; status: string; attempts: number; nextAttemptAt: string; providerMessageId: string | null; lastErrorCode: string | null; createdAt: string; sentAt: string | null }
type EmailConsole = { emails: EmailRecord[]; summary: { total: number; statuses: { status: string; total: number }[]; frequentKinds: { kind: string; total: number }[] }; provider: { provider: string; configured: boolean; code: string | null } }
type RevenueRecord = { day: string; purpose: string; transactionCount: number; revenueKes: number }
type MarketplaceAnalytics = { dailyViews: { day: string; views: number }[]; topListings: { reference: string; title: string; status: string; views: number }[] }
type PaymentSummary = { transactions: number; states: { status: string; transactions: number }[]; confirmedRevenueKes: number; revenueByPurpose: { purpose: string; transactions: number; revenueKes: number }[] }
type PaymentEvent = { kind: string; at: string; outcome?: string; status?: string; metadata?: Record<string, unknown> }
type PaymentDetail = Payment & { merchantRequestId: string; checkoutRequestId: string | null; callbackReceived: boolean; reconciliationRequired: boolean; events: PaymentEvent[] }
type ListingReport = { id: string; reference: string; title: string; reason: string; details: string | null; reporterEmail: string | null; status: string; createdAt: string }
type FeeSettings = { publicationFeeBasisPoints: number; contactUnlockFeeBasisPoints: number; listingExpiryDays: number }
type FooterSocialSettings = { facebookUrl: string; xUrl: string; youtubeUrl: string; whatsappPhone: string }
type Dashboard = { listings: { total: number; published: number; pendingPayment: number; sold: number; expired: number; suspended: number }; payments: { successful: number; failed: number; pending: number; ambiguous: number }; reports: { open: number }; revenueKes?: { publication: number; contactUnlock: number }; recentListings: Listing[] }

const adminApi = '/api/v1/admin/marketplace'
const sectionTitles: Record<string, string> = { dashboard: 'Dashboard', listings: 'Listings', payments: 'All Transactions', buyers: 'Buyers', reports: 'Reports', sellers: 'Sellers', categories: 'Categories', admins: 'Admin Users', settings: 'Settings', revenue: 'Revenue Overview', 'publication-fees': 'Publication Fees', 'contact-unlock-fees': 'Contact Unlock Fees', analytics: 'Marketplace Analytics', 'listing-performance': 'Listing Performance', 'payment-reports': 'Payment Reports', reconciliation: 'M-Pesa Reconciliation', activity: 'Activity Logs', notifications: 'Notifications', 'email-dashboard': 'Email Dashboard', 'email-compose': 'Compose Email', 'email-sent': 'Sent Emails', 'email-failed': 'Failed Emails', 'email-queue': 'Email Queue' }
const kitzAdminOrigin = import.meta.env.VITE_KITZ_ORIGIN || 'https://kitz.onrender.com'
const kes = (value: number) => `KSh ${new Intl.NumberFormat('en-KE').format(value)}`
const formatEAT = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' }).format(new Date(value)) : 'Not recorded'

function MarketplaceAdminSidebar({ section, permissions, onLogout }: { section: string; permissions: string[]; onLogout: () => void }) {
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('mh-admin-collapsed-groups') ?? '[]') as string[] } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem('mh-admin-collapsed-groups', JSON.stringify(collapsedGroups)) } catch { /* Sidebar preference is nonessential. */ }
  }, [collapsedGroups])
  const link = (target: string, label: string, Icon: typeof LayoutDashboard, href?: string) => <Link className={section === target ? 'active' : ''} to={href ?? `/admin/marketplace/dashboard?section=${target}`} key={`${target}-${label}`}><Icon /><span>{label}</span></Link>
  const group = (title: string, items: ReactNode[]) => <div className="admin-nav-group" key={title}><button type="button" aria-expanded={!collapsedGroups.includes(title)} onClick={() => setCollapsedGroups((current) => current.includes(title) ? current.filter((value) => value !== title) : [...current, title])}><span>{title}</span><ChevronDown aria-hidden="true" /></button>{!collapsedGroups.includes(title) && <div>{items}</div>}</div>
  return <aside className="admin-sidebar">
    <Link to="/admin/marketplace/dashboard" className="admin-logo" aria-label="MATRIX marketplace administration"><Tags /><img src="/images/Glossy%20Blue%20and%20Gold%20Matrix%20Logo.png" alt="MATRIX" /><span><small>Marketplace Admin</small></span></Link>
    <nav aria-label="Marketplace administration">
      {group('OVERVIEW', [link('dashboard', 'Dashboard', LayoutDashboard)])}
      {group('MARKETPLACE', [
        ...(permissions.includes('listings:read') || permissions.includes('listings:manage') ? [link('listings', 'Listings', Box)] : []),
        ...(permissions.includes('categories:manage') ? [link('categories', 'Categories', Tags)] : []),
        ...(permissions.includes('support:manage') ? [link('sellers', 'Sellers', ShieldCheck), link('buyers', 'Buyers', BadgeDollarSign)] : []),
      ])}
      {permissions.includes('finance:read') && group('PAYMENTS', [
        link('payments', 'All Transactions', CreditCard),
        link('payments-successful', 'Successful Payments', CreditCard, '/admin/marketplace/dashboard?section=payments&paymentStatus=succeeded'),
        link('payments-failed', 'Failed Payments', CircleAlert, '/admin/marketplace/dashboard?section=payments&paymentStatus=failed'),
        link('payments-pending', 'Pending Payments', Activity, '/admin/marketplace/dashboard?section=payments&paymentStatus=pending'),
        link('payments-cancelled', 'Cancelled Transactions', CircleAlert, '/admin/marketplace/dashboard?section=payments&paymentStatus=cancelled'),
        link('payments-reversed', 'Reversed Transactions', CircleAlert, '/admin/marketplace/dashboard?section=payments&paymentStatus=reversed'),
        link('reconciliation', 'M-Pesa Reconciliation', Activity),
      ])}
      {permissions.includes('finance:read') && group('FINANCIAL MANAGEMENT', [
        link('revenue', 'Revenue Overview', BadgeDollarSign),
        link('publication-fees', 'Publication Fees', CreditCard),
        link('contact-unlock-fees', 'Contact Unlock Fees', ShieldCheck),
      ])}
      {group('ANALYTICS & REPORTS', [
        ...(permissions.includes('dashboard:read') ? [link('analytics', 'Marketplace Analytics', Activity), link('listing-performance', 'Listing Performance', Eye)] : []),
        ...(permissions.includes('finance:read') ? [link('payment-reports', 'Payment Reports', CreditCard)] : []),
      ])}
      {group('ADMINISTRATION', [
        ...(permissions.includes('admins:manage') ? [link('admins', 'Admin Users', ShieldCheck), link('activity', 'Activity Logs', Activity), link('notifications', 'Notifications', CircleAlert)] : []),
        ...(permissions.includes('settings:manage') ? [link('settings', 'Settings', Settings)] : []),
      ])}
      {permissions.includes('admins:manage') && group('EMAIL MANAGEMENT', [
        link('email-dashboard', 'Email Dashboard', Mail),
        link('email-compose', 'Compose Email', Plus),
        link('email-sent', 'Sent Emails', Mail),
        link('email-failed', 'Failed Emails', CircleAlert),
        link('email-queue', 'Email Queue', Activity),
      ])}
    </nav>
    <div className="admin-sidebar-bottom"><span><ShieldCheck /><span><b>Marketplace only</b><small>Kitz access is separate</small></span></span><button type="button" onClick={onLogout}><LogOut />Sign out</button></div>
  </aside>
}

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
  const [paymentSearch, setPaymentSearch] = useState('')
  const [paymentPage, setPaymentPage] = useState(1)
  const [paymentStatusFilter, setPaymentStatusFilter] = useState(searchParams.get('paymentStatus') ?? '')
  const [paymentPurposeFilter, setPaymentPurposeFilter] = useState('')
  const [paymentMinAmount, setPaymentMinAmount] = useState('')
  const [paymentMaxAmount, setPaymentMaxAmount] = useState('')
  const [paymentFrom, setPaymentFrom] = useState('')
  const [paymentTo, setPaymentTo] = useState('')
  const [paymentPagination, setPaymentPagination] = useState<PaymentPagination | null>(null)
  const [paymentDetail, setPaymentDetail] = useState<PaymentDetail | null>(null)
  const [paymentDetailLoading, setPaymentDetailLoading] = useState(false)
  const [revenueFrom, setRevenueFrom] = useState('')
  const [revenueTo, setRevenueTo] = useState('')
  const [buyers, setBuyers] = useState<BuyerRecord[]>([])
  const [activityLogs, setActivityLogs] = useState<ActivityRecord[]>([])
  const [notificationRows, setNotificationRows] = useState<NotificationRecord[]>([])
  const [emailConsole, setEmailConsole] = useState<EmailConsole | null>(null)
  const [emailPagination, setEmailPagination] = useState<PaymentPagination | null>(null)
  const [emailPage, setEmailPage] = useState(1)
  const [emailSearch, setEmailSearch] = useState('')
  const [emailRecipient, setEmailRecipient] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [revenueRows, setRevenueRows] = useState<RevenueRecord[]>([])
  const [marketplaceAnalytics, setMarketplaceAnalytics] = useState<MarketplaceAnalytics | null>(null)
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null)
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
    setPaymentStatusFilter(searchParams.get('paymentStatus') ?? '')
    setPaymentPurposeFilter(searchParams.get('paymentPurpose') ?? '')
  }, [searchParams])

  useEffect(() => {
    if (isLogin || isActivate || isVerify || section === 'admins') return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const load = async () => {
      const sessionResponse = await marketplaceFetch(`${adminApi}/session`, { signal: controller.signal })
      const session = await sessionResponse.json() as { data?: AdminUser; error?: { message?: string } }
      if (!sessionResponse.ok || !session.data) throw new Error(session.error?.message ?? 'Sign in to continue.')
      setAdmin(session.data)
      const listingQuery = new URLSearchParams({ limit: '50' })
      if (listingSearch.trim()) listingQuery.set('q', listingSearch.trim())
      const paymentQuery = new URLSearchParams({ page: String(paymentPage) })
      if (paymentStatusFilter) paymentQuery.set('status', paymentStatusFilter)
      if (paymentPurposeFilter) paymentQuery.set('purpose', paymentPurposeFilter)
      if (paymentSearch.trim()) paymentQuery.set('q', paymentSearch.trim())
      if (paymentMinAmount) paymentQuery.set('minAmount', paymentMinAmount)
      if (paymentMaxAmount) paymentQuery.set('maxAmount', paymentMaxAmount)
      if (paymentFrom) paymentQuery.set('from', new Date(`${paymentFrom}T00:00:00+03:00`).toISOString())
      if (paymentTo) paymentQuery.set('to', new Date(`${paymentTo}T23:59:59+03:00`).toISOString())
      const revenueQuery = new URLSearchParams()
      if (revenueFrom) revenueQuery.set('from', new Date(`${revenueFrom}T00:00:00+03:00`).toISOString())
      if (revenueTo) revenueQuery.set('to', new Date(`${revenueTo}T23:59:59+03:00`).toISOString())
      const emailQuery = new URLSearchParams({ page: String(emailPage), limit: '50' })
      if (section === 'email-sent') emailQuery.set('status', 'sent')
      if (section === 'email-failed') emailQuery.set('status', 'failed')
      if (section === 'email-queue') emailQuery.set('status', 'queued')
      if (emailSearch.trim()) emailQuery.set('q', emailSearch.trim())
      const endpoint = section === 'listings' ? `${adminApi}/listings?${listingQuery}`
        : section === 'payments' || section === 'reconciliation' ? `${adminApi}/payments?${section === 'reconciliation' ? new URLSearchParams({ page: String(paymentPage), status: paymentStatusFilter || 'ambiguous' }) : paymentQuery}`
          : section === 'buyers' ? `${adminApi}/buyers?page=1`
            : section === 'activity' ? `${adminApi}/activity?page=1`
              : section === 'notifications' ? `${adminApi}/notifications?page=1`
                : section === 'revenue' || section === 'publication-fees' || section === 'contact-unlock-fees' ? `${adminApi}/revenue?${revenueQuery}`
                  : section === 'analytics' || section === 'listing-performance' ? `${adminApi}/analytics`
                    : section === 'payment-reports' ? `${adminApi}/payments/summary`
          : section === 'reports' ? `${adminApi}/reports?status=open`
            : section === 'sellers' ? `${adminApi}/seller-accounts`
              : section.startsWith('email-') ? `${adminApi}/emails?${emailQuery}`
                : section === 'settings' ? `${adminApi}/settings/fees`
                : section === 'categories' ? `${adminApi}/categories`
                  : `${adminApi}/dashboard`
      const response = await marketplaceFetch(endpoint, { signal: controller.signal })
      const result = await response.json() as { data?: Dashboard | Listing[] | Payment[] | ListingReport[] | MarketplaceSellerAccount[] | Category[] | FeeSettings | FooterSocialSettings | BuyerRecord[] | ActivityRecord[] | NotificationRecord[] | EmailConsole | RevenueRecord[] | MarketplaceAnalytics | PaymentSummary; pagination?: PaymentPagination; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Marketplace data could not be loaded.')
      if (section === 'listings') setListings(result.data as Listing[])
      else if (section === 'payments') { setPayments(result.data as Payment[]); setPaymentPagination(result.pagination ?? null) }
      else if (section === 'buyers') setBuyers(result.data as BuyerRecord[])
      else if (section === 'activity') setActivityLogs(result.data as ActivityRecord[])
      else if (section === 'notifications') setNotificationRows(result.data as NotificationRecord[])
      else if (section.startsWith('email-')) { setEmailConsole(result.data as EmailConsole); setEmailPagination(result.pagination ?? null) }
      else if (section === 'revenue' || section === 'publication-fees' || section === 'contact-unlock-fees') setRevenueRows(result.data as RevenueRecord[])
      else if (section === 'analytics' || section === 'listing-performance') setMarketplaceAnalytics(result.data as MarketplaceAnalytics)
      else if (section === 'payment-reports') setPaymentSummary(result.data as PaymentSummary)
      else if (section === 'reports') setReports(result.data as ListingReport[])
      else if (section === 'sellers') setSellerAccounts(result.data as MarketplaceSellerAccount[])
      else if (section === 'settings') {
        setFeeSettings(result.data as FeeSettings)
        const socialResponse = await marketplaceFetch(`${adminApi}/settings/footer-social-links`, { signal: controller.signal })
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
  }, [emailPage, emailSearch, isLogin, isActivate, isVerify, listingSearch, navigate, paymentFrom, paymentMaxAmount, paymentMinAmount, paymentPage, paymentPurposeFilter, paymentSearch, paymentStatusFilter, paymentTo, revenueFrom, revenueTo, section])

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
      const response = await marketplaceFetch(`${adminApi}/seller-accounts/${account.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
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
      const response = await marketplaceFetch(`${adminApi}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
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
      const response = await marketplaceFetch(`${adminApi}/invitations/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken, password, confirmPassword }) })
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
      const response = await marketplaceFetch(`${adminApi}/invitations/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken }) })
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
    await marketplaceFetch(`${adminApi}/logout`, { method: 'POST' })
    navigate('/admin/marketplace/login', { replace: true })
  }

  async function changeListingStatus(reference: string, status: 'suspended' | 'published' | 'sold' | 'removed') {
    setBusy(true)
    setError('')
    try {
      const response = await marketplaceFetch(`${adminApi}/listings/${reference}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
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
      const response = await marketplaceFetch(`${adminApi}/payments/${reference}/reconcile`, { method: 'POST' })
      const result = await response.json() as { data?: { status: string }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Payment reconciliation failed.')
      setPayments((current) => current.map((payment) => payment.reference === reference ? { ...payment, status: result.data!.status } : payment))
      setNotice(result.data.status === 'succeeded' ? 'Payment verified and reconciled.' : 'No verified success was found; payment remains unresolved.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Payment reconciliation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function openPaymentDetail(reference: string) {
    setPaymentDetailLoading(true)
    setError('')
    try {
      const response = await marketplaceFetch(`${adminApi}/payments/${reference}`)
      const result = await response.json() as { data?: PaymentDetail; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Payment details could not be loaded.')
      setPaymentDetail(result.data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Payment details could not be loaded.')
    } finally {
      setPaymentDetailLoading(false)
    }
  }

  async function queueComposedEmail(test = false) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const payload = { subject: emailSubject, body: emailBody, ...(test ? {} : { to: emailRecipient }) }
      const response = await marketplaceFetch(`${adminApi}/emails/${test ? 'test' : 'send'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json() as { data?: { status: string }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Email could not be queued.')
      setNotice(test ? 'Test email queued to your administrator address.' : `Email queued for ${emailRecipient.trim()}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Email could not be queued.')
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
      const response = await marketplaceFetch(`${adminApi}/reports/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
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
      const response = await marketplaceFetch(`${adminApi}/settings/fees`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(feeSettings) })
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
      const response = await marketplaceFetch(`${adminApi}/settings/footer-social-links`, {
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
    const response = await marketplaceFetch(`${adminApi}/categories/${category.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !category.active }) })
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
    const response = await marketplaceFetch(`${adminApi}/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: categoryName, slug }) })
    const result = await response.json() as { data?: Category; error?: { message?: string } }
    if (!response.ok || !result.data) {
      setCategoryError(result.error?.message ?? 'Category could not be created.')
      return
    }
    setCategories((current) => [...current, result.data!].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)))
    setCategoryName('')
  }

  const dataSections = ['payments', 'reconciliation', 'buyers', 'activity', 'notifications', 'email-dashboard', 'email-compose', 'email-sent', 'email-failed', 'email-queue', 'revenue', 'publication-fees', 'contact-unlock-fees', 'analytics', 'listing-performance', 'payment-reports']
  if (dataSections.includes(section)) return <div className="admin-app">
    <MarketplaceAdminSidebar section={section} permissions={admin?.permissions ?? []} onLogout={() => void logout()} />
    <main className="admin-main">
      <header className="admin-topbar"><Link to="/admin/marketplace/dashboard">Marketplace dashboard</Link><span className="admin-user"><b>{admin?.role.replaceAll('_', ' ')}</b><small>{admin?.email}</small></span></header>
      <section className="admin-workspace">
        <div className="admin-page-title"><div><span>MARKETPLACE OPERATIONS &amp; FINANCE</span><h1>{sectionTitles[section]}</h1></div></div>
        {error && <div className="admin-alert" role="alert"><CircleAlert size={16} />{error}</div>}
        {notice && <p className="admin-success-message" role="status">{notice}</p>}
        {loading ? <div className="admin-loading">Loading persisted marketplace records…</div> : null}
        {!loading && section === 'email-compose' && <div className="admin-email-compose">
          <div className="admin-panel"><header><div><h2>Compose operational email</h2><span>Single recipient · queued through the configured MarketHub provider</span></div></header><form onSubmit={(event) => { event.preventDefault(); if (window.confirm(`Queue this email for ${emailRecipient.trim()}?`)) void queueComposedEmail() }}>
            <label>Recipient email<input type="email" required maxLength={254} value={emailRecipient} onChange={(event) => setEmailRecipient(event.target.value)} placeholder="recipient@example.com" /></label>
            <label>Subject<input required minLength={2} maxLength={180} value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} placeholder="A message from MarketHub" /></label>
            <label>Message<textarea required minLength={2} maxLength={5000} rows={10} value={emailBody} onChange={(event) => setEmailBody(event.target.value)} placeholder="Write your message in plain text." /></label>
            <div className="admin-email-compose-actions"><button className="admin-reconcile" type="button" disabled={busy || !emailSubject.trim() || !emailBody.trim()} onClick={() => void queueComposedEmail(true)}>{busy ? 'Queueing…' : 'Send test to me'}</button><button type="submit" disabled={busy || !emailRecipient.trim() || !emailSubject.trim() || !emailBody.trim()}>{busy ? 'Queueing…' : 'Review and queue'}</button></div>
          </form></div>
          <aside className="admin-panel admin-email-preview"><header><div><h2>Preview</h2><span>Plain-text content in MarketHub branding</span></div></header><article><strong>{emailSubject.trim() || 'Your subject will appear here'}</strong><div>{emailBody || 'Your message preview will appear here.'}</div><footer>MarketHub Kenya · Authorized administrator message</footer></article></aside>
        </div>}
        {!loading && ['email-dashboard', 'email-sent', 'email-failed', 'email-queue'].includes(section) && <div className="admin-email-console">
          {section === 'email-dashboard' && <>
            <div className="admin-kpis"><article><span><Mail /></span><div><small>Email events</small><strong>{emailConsole?.summary.total.toLocaleString('en-KE') ?? '—'}</strong></div></article><article><span><Check /></span><div><small>Provider accepted</small><strong>{emailConsole?.summary.statuses.find((item) => item.status === 'sent')?.total.toLocaleString('en-KE') ?? 0}</strong></div></article><article><span><CircleAlert /></span><div><small>Failed or uncertain</small><strong>{(emailConsole?.summary.statuses.filter((item) => ['failed', 'uncertain'].includes(item.status)).reduce((total, item) => total + item.total, 0) ?? 0).toLocaleString('en-KE')}</strong></div></article><article><span><Activity /></span><div><small>Queued / sending</small><strong>{(emailConsole?.summary.statuses.filter((item) => ['pending', 'sending'].includes(item.status)).reduce((total, item) => total + item.total, 0) ?? 0).toLocaleString('en-KE')}</strong></div></article></div>
            <div className="admin-panel"><header><div><h2>Provider status</h2><span>{emailConsole?.provider.provider ?? 'Unknown'}</span></div><span className={`status-pill status-${emailConsole?.provider.configured ? 'succeeded' : 'failed'}`}>{emailConsole?.provider.configured ? 'Configured' : emailConsole?.provider.code ?? 'Unavailable'}</span></header><p className="admin-ledger-note">A sent record confirms provider acceptance only. Mailbox delivery events are not integrated with the configured provider.</p></div>
            <div className="admin-panel"><header><h2>Most-used notification types</h2></header><div className="admin-table-wrap"><table><thead><tr><th>Notification type</th><th>Recorded events</th></tr></thead><tbody>{emailConsole?.summary.frequentKinds.map((item) => <tr key={item.kind}><td>{item.kind.replaceAll('_', ' ')}</td><td>{item.total.toLocaleString('en-KE')}</td></tr>)}{!emailConsole?.summary.frequentKinds.length && <tr><td colSpan={2}>No email events are recorded.</td></tr>}</tbody></table></div></div>
          </>}
          {section !== 'email-dashboard' && <div className="admin-panel"><header><div><h2>{section === 'email-sent' ? 'Sent Emails' : section === 'email-failed' ? 'Failed Emails' : 'Email Queue'}</h2><span>{emailPagination?.total.toLocaleString('en-KE') ?? 0} matching records</span></div></header><div className="admin-payment-filters"><label>Search recipient or event<input value={emailSearch} onChange={(event) => { setEmailSearch(event.target.value); setEmailPage(1) }} placeholder="Email, event type, or event key" /></label></div><div className="admin-table-wrap"><table><thead><tr><th>Recipient</th><th>Notification</th><th>Status</th><th>Attempts</th><th>Provider message</th><th>Last updated</th><th>Action</th></tr></thead><tbody>{emailConsole?.emails.map((item) => <tr key={item.id}><td>{item.recipientEmail}</td><td>{item.kind.replaceAll('_', ' ')}<small>{item.eventKey}</small></td><td><span className={`status-pill status-${item.status}`}>{item.status === 'sent' ? 'provider accepted' : item.status}</span>{item.lastErrorCode && <small>{item.lastErrorCode}</small>}</td><td>{item.attempts}</td><td>{item.providerMessageId ?? 'Not recorded'}</td><td>{formatEAT(item.sentAt ?? item.createdAt)}</td><td>{section === 'email-failed' && item.status === 'failed' && <button className="admin-reconcile" type="button" disabled={busy} onClick={async () => { const response = await marketplaceFetch(`${adminApi}/email-events/${item.id}/retry`, { method: 'POST' }); const result = await response.json() as { error?: { message?: string } }; if (!response.ok || result.error) setError('Email could not be requeued.'); else { setEmailConsole((current) => current ? { ...current, emails: current.emails.map((email) => email.id === item.id ? { ...email, status: 'pending', attempts: 0, lastErrorCode: null } : email) } : current); setNotice('Email requeued for retry.') } }}>Retry</button>}</td></tr>)}{!emailConsole?.emails.length && <tr><td colSpan={7}>No email records match this view.</td></tr>}</tbody></table></div><footer className="admin-payment-pagination"><span>{emailPagination ? `Page ${emailPagination.page} · ${emailPagination.total} emails` : 'Email records'}</span><div><button className="admin-reconcile" type="button" disabled={!emailPagination || emailPagination.page <= 1} onClick={() => setEmailPage((page) => Math.max(1, page - 1))}>Previous</button><button className="admin-reconcile" type="button" disabled={!emailPagination?.hasMore} onClick={() => setEmailPage((page) => page + 1)}>Next</button></div></footer></div>}
        </div>}
        {!loading && (section === 'payments' || section === 'reconciliation') && <div className="admin-panel admin-payments-panel">
          <header><div><h2>{section === 'reconciliation' ? 'M-Pesa Reconciliation Queue' : 'All Transactions'}</h2><span>{paymentPagination?.total ?? payments.length} recorded payment attempts</span></div><button className="admin-reconcile" type="button" disabled={!payments.length} onClick={exportPaymentsCsv}>Export CSV</button></header>
          {section === 'reconciliation' && <p className="admin-ledger-note">Pending or ambiguous attempts remain unresolved until Daraja verification confirms an outcome. No callback is treated as a successful payment.</p>}
          <div className="admin-payment-filters">
            <label>Search transaction, receipt, phone<input value={paymentSearch} onChange={(event) => { setPaymentSearch(event.target.value); setPaymentPage(1) }} placeholder="Reference, receipt, or phone" /></label>
            <label>Status<select value={paymentStatusFilter} onChange={(event) => { setPaymentStatusFilter(event.target.value); setPaymentPage(1) }}><option value="">All statuses</option><option value="initiated">Initiated</option><option value="pending">Pending</option><option value="processing">Processing</option><option value="ambiguous">Unresolved</option><option value="succeeded">Successful</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option><option value="expired">Timeout / expired</option><option value="reversed">Reversed</option><option value="refunded">Refunded</option></select></label>
            <label>Purpose<select value={paymentPurposeFilter} onChange={(event) => { setPaymentPurposeFilter(event.target.value); setPaymentPage(1) }}><option value="">All purposes</option><option value="PRODUCT_PUBLICATION">Publication</option><option value="CONTACT_UNLOCK">Contact unlock</option></select></label>
            <label>Min KSh<input type="number" min="0" value={paymentMinAmount} onChange={(event) => { setPaymentMinAmount(event.target.value); setPaymentPage(1) }} /></label>
            <label>Max KSh<input type="number" min="0" value={paymentMaxAmount} onChange={(event) => { setPaymentMaxAmount(event.target.value); setPaymentPage(1) }} /></label>
            <label>From date<input type="date" value={paymentFrom} onChange={(event) => { setPaymentFrom(event.target.value); setPaymentPage(1) }} /></label>
            <label>To date<input type="date" value={paymentTo} onChange={(event) => { setPaymentTo(event.target.value); setPaymentPage(1) }} /></label>
          </div>
          <div className="admin-table-wrap"><table><thead><tr><th>Transaction ID</th><th>Receipt</th><th>Phone</th><th>Purpose</th><th>Listing</th><th>Amount</th><th>Status</th><th>Started</th><th>Verified</th><th>Action</th></tr></thead><tbody>{payments.length ? payments.map((payment) => <tr key={payment.reference}><td><button className="admin-link-button" type="button" onClick={() => void openPaymentDetail(payment.reference)}>{payment.transactionId}</button><small>{payment.reference}</small></td><td>{payment.providerReceipt ?? 'Not recorded'}</td><td>{payment.phone}</td><td>{payment.purpose.replaceAll('_', ' ')}</td><td>{payment.listingReference ?? '—'}</td><td>{kes(payment.amountKes)} {payment.currency}</td><td><span className={`status-pill status-${payment.status}`}>{payment.status}</span></td><td>{formatEAT(payment.stkPushSubmittedAt ?? payment.createdAt)}</td><td>{formatEAT(payment.verifiedAt)}</td><td><button className="admin-reconcile" type="button" disabled={paymentDetailLoading} onClick={() => void openPaymentDetail(payment.reference)}>{paymentDetailLoading ? 'Loading…' : 'Details'}</button>{['pending', 'ambiguous'].includes(payment.status) && <button className="admin-reconcile" type="button" disabled={busy} onClick={() => void reconcilePayment(payment.reference)}>Reconcile</button>}</td></tr>) : <tr><td colSpan={10}>No payment records match these filters.</td></tr>}</tbody></table></div>
          <footer className="admin-payment-pagination"><span>{paymentPagination ? `Page ${paymentPagination.page} · ${paymentPagination.total} payments` : 'Payment records'}</span><div><button className="admin-reconcile" type="button" disabled={busy || paymentPage <= 1} onClick={() => setPaymentPage((page) => Math.max(1, page - 1))}>Previous</button><button className="admin-reconcile" type="button" disabled={busy || !paymentPagination?.hasMore} onClick={() => setPaymentPage((page) => page + 1)}>Next</button></div></footer>
        </div>}
        {!loading && section === 'payment-reports' && <div className="admin-panel"><header><h2>Payment reports</h2><span>Persisted transactions only</span></header><div className="admin-kpis"><article><span><CreditCard /></span><div><small>Total attempts</small><strong>{paymentSummary?.transactions ?? 0}</strong></div></article><article><span><BadgeDollarSign /></span><div><small>Confirmed revenue</small><strong>{kes(paymentSummary?.confirmedRevenueKes ?? 0)}</strong><em>Succeeded payments only</em></div></article></div><div className="admin-table-wrap"><table><thead><tr><th>Payment status</th><th>Transactions</th></tr></thead><tbody>{paymentSummary?.states.map((row) => <tr key={row.status}><td>{row.status}</td><td>{row.transactions.toLocaleString('en-KE')}</td></tr>)}</tbody></table></div><div className="admin-table-wrap"><table><thead><tr><th>Purpose</th><th>Verified transactions</th><th>Confirmed revenue</th></tr></thead><tbody>{paymentSummary?.revenueByPurpose.map((row) => <tr key={row.purpose}><td>{row.purpose.replaceAll('_', ' ')}</td><td>{row.transactions.toLocaleString('en-KE')}</td><td>{kes(row.revenueKes)}</td></tr>)}</tbody></table></div></div>}
        {!loading && ['revenue', 'publication-fees', 'contact-unlock-fees'].includes(section) && <div className="admin-panel"><header><div><h2>{sectionTitles[section]}</h2><span>Verified payments only · displayed in Africa/Nairobi</span></div></header><div className="admin-payment-filters"><label>From<input type="date" value={revenueFrom} onChange={(event) => setRevenueFrom(event.target.value)} /></label><label>To<input type="date" value={revenueTo} onChange={(event) => setRevenueTo(event.target.value)} /></label></div><div className="admin-table-wrap"><table><thead><tr><th>Date (EAT)</th><th>Purpose</th><th>Verified transactions</th><th>Confirmed revenue</th></tr></thead><tbody>{revenueRows.filter((row) => section === 'revenue' || row.purpose === (section === 'publication-fees' ? 'PRODUCT_PUBLICATION' : 'CONTACT_UNLOCK')).map((row, index) => <tr key={`${row.day}-${row.purpose}-${index}`}><td>{row.day}</td><td>{row.purpose.replaceAll('_', ' ')}</td><td>{row.transactionCount.toLocaleString('en-KE')}</td><td>{kes(row.revenueKes)}</td></tr>)}{!revenueRows.length && <tr><td colSpan={4}>No verified revenue has been recorded for this range.</td></tr>}</tbody></table></div></div>}
        {!loading && ['analytics', 'listing-performance'].includes(section) && <div className="admin-panel"><header><h2>{sectionTitles[section]}</h2><span>Recorded product page views</span></header><div className="admin-dashboard-columns"><div className="admin-table-wrap"><table><thead><tr><th>Date (EAT)</th><th>Listing views</th></tr></thead><tbody>{marketplaceAnalytics?.dailyViews.map((row) => <tr key={row.day}><td>{row.day}</td><td>{row.views.toLocaleString('en-KE')}</td></tr>)}</tbody></table></div><div className="admin-table-wrap"><table><thead><tr><th>Listing</th><th>Status</th><th>Views</th></tr></thead><tbody>{marketplaceAnalytics?.topListings.map((row) => <tr key={row.reference}><td><b>{row.title}</b><small>{row.reference}</small></td><td>{row.status.replaceAll('_', ' ')}</td><td>{row.views.toLocaleString('en-KE')}</td></tr>)}</tbody></table></div></div></div>}
        {!loading && section === 'buyers' && <div className="admin-panel"><header><h2>Contact-unlock buyers</h2><span>Verified contact unlocks only</span></header><div className="admin-table-wrap"><table><thead><tr><th>Masked phone</th><th>Email</th><th>Unlocks</th><th>Last verified payment</th></tr></thead><tbody>{buyers.map((buyer, index) => <tr key={`${buyer.phone}-${buyer.email}-${index}`}><td>{buyer.phone}</td><td>{buyer.email ?? 'Not recorded'}</td><td>{buyer.unlockCount}</td><td>{formatEAT(buyer.lastPaymentAt)}</td></tr>)}{!buyers.length && <tr><td colSpan={4}>No verified contact-unlock buyers are recorded.</td></tr>}</tbody></table></div></div>}
        {!loading && section === 'activity' && <div className="admin-panel"><header><h2>Administrator Activity</h2><span>Append-only audit records</span></header><div className="admin-table-wrap"><table><thead><tr><th>Action</th><th>Administrator</th><th>Target</th><th>Date and time (EAT)</th></tr></thead><tbody>{activityLogs.map((entry) => <tr key={entry.id}><td>{entry.action}</td><td>{entry.adminEmail ?? 'System / seller'}</td><td>{entry.resourceType}{entry.resourceId ? ` · ${entry.resourceId}` : ''}</td><td>{formatEAT(entry.createdAt)}</td></tr>)}{!activityLogs.length && <tr><td colSpan={4}>No audit events have been recorded.</td></tr>}</tbody></table></div></div>}
        {!loading && section === 'notifications' && <div className="admin-panel"><header><h2>Marketplace Notifications</h2><span>Persisted seller notification attempts</span></header><div className="admin-table-wrap"><table><thead><tr><th>Type</th><th>Seller</th><th>Status</th><th>Provider reference</th><th>Created</th><th>Sent</th></tr></thead><tbody>{notificationRows.map((row) => <tr key={row.id}><td>{row.kind}</td><td>{row.sellerName ?? 'Seller unavailable'}</td><td>{row.status}</td><td>{row.providerReference ?? '—'}</td><td>{formatEAT(row.createdAt)}</td><td>{formatEAT(row.sentAt)}</td></tr>)}{!notificationRows.length && <tr><td colSpan={6}>No notification records are available.</td></tr>}</tbody></table></div></div>}
      </section>
    </main>
    {paymentDetail && <div className="admin-payment-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaymentDetail(null) }}><section className="admin-payment-detail" role="dialog" aria-modal="true" aria-labelledby="payment-detail-title"><header><div><span className="admin-eyebrow">TRANSACTION DETAIL</span><h2 id="payment-detail-title">{paymentDetail.reference}</h2></div><button type="button" className="admin-detail-close" aria-label="Close payment detail" onClick={() => setPaymentDetail(null)}>×</button></header><dl><div><dt>Internal ID</dt><dd>{paymentDetail.transactionId}</dd></div><div><dt>Purpose / amount</dt><dd>{paymentDetail.purpose} · {kes(paymentDetail.amountKes)} KES</dd></div><div><dt>Status</dt><dd>{paymentDetail.status}</dd></div><div><dt>Phone</dt><dd>{paymentDetail.phone}</dd></div><div><dt>Listing</dt><dd>{paymentDetail.listingReference ?? '—'}</dd></div><div><dt>MerchantRequestID</dt><dd>{paymentDetail.merchantRequestId}</dd></div><div><dt>CheckoutRequestID</dt><dd>{paymentDetail.checkoutRequestId ?? 'Not recorded'}</dd></div><div><dt>M-Pesa receipt</dt><dd>{paymentDetail.providerReceipt ?? 'Not recorded'}</dd></div><div><dt>Daraja response</dt><dd>{paymentDetail.providerResponseCode ?? 'Not recorded'} · {paymentDetail.providerResponseDescription ?? 'Not recorded'}</dd></div><div><dt>Failure</dt><dd>{paymentDetail.failureCategory ?? 'None recorded'} · {paymentDetail.failureReason ?? 'Not recorded'}</dd></div><div><dt>Callback received</dt><dd>{paymentDetail.callbackReceived ? 'Yes' : 'No'}</dd></div><div><dt>Reconciliation</dt><dd>{paymentDetail.reconciliationRequired ? 'Required / unresolved' : 'Not required'}</dd></div></dl><h3>Recorded payment timeline</h3><ol>{paymentDetail.events.map((event, index) => <li key={`${event.kind}-${event.at}-${index}`}><strong>{event.kind.replaceAll('_', ' ')}</strong><time>{formatEAT(event.at)}</time>{event.outcome && <span>{event.outcome}</span>}</li>)}</ol></section></div>}
  </div>

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
    <MarketplaceAdminSidebar section={section} permissions={admin?.permissions ?? []} onLogout={() => void logout()} />
    <main className="admin-main"><header className="admin-topbar"><Link to="/admin/marketplace/dashboard">Marketplace dashboard</Link><span className="admin-user"><b>{admin?.role.replaceAll('_', ' ')}</b><small>{admin?.email}</small></span></header><section className="admin-workspace"><div className="admin-page-title"><div><span>SELLER SUPPORT</span><h1>Seller accounts</h1></div></div>{error && <div className="admin-alert" role="alert"><CircleAlert size={16} />{error}</div>}{notice && <p className="admin-success-message" role="status">{notice}</p>}<div className="admin-panel"><header><h2>Verified seller access</h2><span>{sellerAccounts.length} accounts</span></header><div className="admin-table-wrap"><table><thead><tr><th>Seller</th><th>Email</th><th>Location</th><th>Verification</th><th>Status</th><th>Action</th></tr></thead><tbody>{sellerAccounts.map((account) => <tr key={account.id}><td>{account.sellerName ?? 'Seller account'}</td><td>{account.email}</td><td>{account.town && account.county ? `${account.town}, ${account.county}` : '—'}</td><td>{account.emailVerifiedAt ? 'Verified' : 'Pending'}</td><td><span className={`status-pill status-${account.status}`}>{account.status}</span></td><td>{account.emailVerifiedAt && ['active', 'suspended'].includes(account.status) && <button className="admin-reconcile" type="button" disabled={busy} onClick={() => void updateSellerStatus(account)}>{account.status === 'active' ? 'Suspend' : 'Reactivate'}</button>}</td></tr>)}{!sellerAccounts.length && !loading && <tr><td colSpan={6}>No seller accounts found.</td></tr>}</tbody></table></div></div></section></main>
  </div>

  if (section === 'categories') return <div className="admin-app">
    <MarketplaceAdminSidebar section={section} permissions={admin?.permissions ?? []} onLogout={() => void logout()} />
    <main className="admin-main"><header className="admin-topbar"><Link to="/admin/marketplace/dashboard">Marketplace dashboard</Link><span className="admin-user"><b>{admin?.role.replaceAll('_', ' ')}</b><small>{admin?.email}</small></span></header><section className="admin-workspace"><div className="admin-page-title"><div><span>MARKETPLACE OPERATIONS</span><h1>Categories</h1></div></div>{error && <div className="admin-alert" role="alert">{error}</div>}<div className="admin-panel"><header><h2>Marketplace categories</h2><span>Manage listing taxonomy</span></header><form className="admin-category-form" onSubmit={createCategory}><label>New category<input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Category name" /></label><button><Plus size={15} />Add category</button></form>{categoryError && <p className="admin-alert">{categoryError}</p>}<div className="admin-table-wrap"><table><thead><tr><th>Category</th><th>Slug</th><th>State</th><th>Action</th></tr></thead><tbody>{categories.map((category) => <tr key={category.id}><td>{category.name}</td><td>{category.slug}</td><td>{category.active ? 'Active' : 'Disabled'}</td><td><button className="admin-reconcile" onClick={() => void toggleCategory(category)}>{category.active ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table></div></div></section></main>
  </div>

  if (section === 'settings') return <div className="admin-app">
    <MarketplaceAdminSidebar section={section} permissions={admin?.permissions ?? []} onLogout={() => void logout()} />
    <main className="admin-main"><header className="admin-topbar"><Link to="/admin/marketplace/dashboard">Marketplace dashboard</Link><span className="admin-user"><b>{admin?.role.replaceAll('_', ' ')}</b><small>{admin?.email}</small></span></header><section className="admin-workspace"><div className="admin-page-title"><div><span>MARKETPLACE OPERATIONS</span><h1>Settings</h1></div></div>{error && <div className="admin-alert" role="alert">{error}</div>}<div className="admin-panel admin-settings-panel"><header><h2>Marketplace fees and listing visibility</h2><span>Listing duration begins after verified publication</span></header><form onSubmit={saveFees}><label>Publication fee (basis points)<input type="number" min="1" max="10000" step="1" value={feeSettings.publicationFeeBasisPoints} onChange={(event) => setFeeSettings((current) => ({ ...current, publicationFeeBasisPoints: Number(event.target.value) }))} /></label><small>Basis points: 100 = 1%. Current rate: {feeSettings.publicationFeeBasisPoints / 100}%.</small><label>Contact unlock fee (basis points)<input type="number" min="1" max="10000" step="1" value={feeSettings.contactUnlockFeeBasisPoints} onChange={(event) => setFeeSettings((current) => ({ ...current, contactUnlockFeeBasisPoints: Number(event.target.value) }))} /></label><small>Current rate: {feeSettings.contactUnlockFeeBasisPoints / 100}%.</small><label>Listing visibility (days)<input type="number" min="1" max="365" step="1" value={feeSettings.listingExpiryDays} onChange={(event) => setFeeSettings((current) => ({ ...current, listingExpiryDays: Number(event.target.value) }))} /></label><small>Published listings become unavailable when this period ends.</small><button disabled={busy}>{busy ? 'Saving…' : 'Save fee settings'}</button></form></div><div className="admin-panel admin-settings-panel"><header><h2>Footer social links</h2><span>Only configured destinations are clickable</span></header><form onSubmit={saveFooterSocialSettings}><label>Facebook profile URL<input type="url" value={footerSocialSettings.facebookUrl} onChange={(event) => setFooterSocialSettings((current) => ({ ...current, facebookUrl: event.target.value }))} placeholder="https://facebook.com/your-page" /></label><label>X profile URL<input type="url" value={footerSocialSettings.xUrl} onChange={(event) => setFooterSocialSettings((current) => ({ ...current, xUrl: event.target.value }))} placeholder="https://x.com/your-profile" /></label><label>YouTube channel URL<input type="url" value={footerSocialSettings.youtubeUrl} onChange={(event) => setFooterSocialSettings((current) => ({ ...current, youtubeUrl: event.target.value }))} placeholder="https://youtube.com/@your-channel" /></label><label>WhatsApp mobile number (Kenya)<input type="tel" inputMode="tel" value={footerSocialSettings.whatsappPhone} onChange={(event) => setFooterSocialSettings((current) => ({ ...current, whatsappPhone: event.target.value }))} placeholder="0712 345 678" /></label><small>Enter a Kenyan mobile number; the footer will create the WhatsApp link using country code +254.</small><button disabled={busy}>{busy ? 'Saving…' : 'Save footer links'}</button></form></div></section></main>
  </div>

  const title = sectionTitles[section] ?? 'Dashboard'
  return <div className="admin-app">
    <MarketplaceAdminSidebar section={section} permissions={admin?.permissions ?? []} onLogout={() => void logout()} />
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
