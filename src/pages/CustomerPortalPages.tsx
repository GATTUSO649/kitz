import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Copy, Heart, LockKeyhole, MapPin, Package, Search, Send, ShieldCheck, Smartphone, Trash2, UserRound } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { GoogleMapView } from '../components/GoogleMapView'
import { KenyanPhoneInput } from '../components/KenyanPhoneInput'

type Customer = { id: number; email: string; fullName: string }
type Profile = Customer & { phone: string | null; emailVerifiedAt: string | null; createdAt: string }
type Address = {
  id: number
  label: string
  recipientName: string
  phone: string
  address: string
  county: string
  town: string
  estate: string | null
  landmark: string | null
  instructions: string | null
  latitude: string | null
  longitude: string | null
  isDefault: boolean
}
type SavedProduct = { id: number; name: string; slug: string; description: string; price: string; imageUrl: string | null }
type Order = { orderNumber: string; status: string; paymentMethod: 'pay_on_delivery' | 'mpesa'; currency: string; subtotal: string; deliveryFee: string; total: string; createdAt: string }
type OrderDetail = Order & {
  items: { name: string; size: string; customization: string | null; quantity: number; unitPrice: string }[]
  payment: { status: string; providerReceipt: string | null; payerPhone: string | null; payerName: string | null; transactionAt: string | null; verificationMessage: string | null; createdAt: string; updatedAt: string } | null
}
type PortalOrder = Pick<Order, 'orderNumber' | 'status' | 'paymentMethod' | 'total' | 'createdAt'>
type SupportRequest = {
  id: number
  category: string
  subject: string
  message: string
  status: string
  adminResponse: string | null
  createdAt: string
  updatedAt: string
  orderNumber: string | null
}
type SupportMessage = {
  id: number
  senderType: 'customer' | 'admin'
  body: string
  latitude: string | null
  longitude: string | null
  productName?: string | null
  productPrice?: string | null
  productImageUrl?: string | null
  productUrl?: string | null
  deliveredAt: string | null
  readAt: string | null
  createdAt: string
}
type ChatKitPreview = { name: string; price: number; imageUrl: string | null; productUrl: string }
type OrderTracking = {
  orderNumber: string
  status: string
  destination: { latitude: number | null; longitude: number | null; accuracy: number | null; town: string | null; county: string | null }
  courier: { latitude: number | null; longitude: number | null; updatedAt: string } | null
}
type AccountSummary = { orderCount: number; savedAddressCount: number; wishlistCount: number }
type CustomerNotification = {
  id: number
  type: 'order' | 'support' | 'announcement'
  title: string
  body: string
  href: string | null
  readAt: string | null
  createdAt: string
}

const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 })
async function readAccountData<T>(path: string): Promise<T> {
  const response = await fetch(path)
  const result = await response.json() as { data?: T; error?: { message?: string } }
  if (!response.ok || result.data === undefined) throw new Error(result.error?.message ?? 'Could not load account details.')
  return result.data
}

function AccountMessage({ error, message }: { error?: string; message?: string }) {
  if (error) return <p className="portal-message error-state" role="alert">{error}</p>
  if (message) return <p className="portal-message" role="status">{message}</p>
  return null
}

function PortalHeader({ kicker, title, description }: { kicker: string; title: string; description: string }) {
  return <header className="portal-page-header">
    <div><span className="eyebrow">{kicker}</span><h1>{title}</h1><p className="standalone-intro">{description}</p></div>
    <Link to="/account/profile" className="portal-profile-link" aria-label="Edit your profile"><UserRound size={16} /> <span>Profile</span></Link>
  </header>
}

function SupportConversation({ request, userId, initialOpen = false, showToggle = true }: { request: SupportRequest; userId: number; initialOpen?: boolean; showToggle?: boolean }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [isOpen, setIsOpen] = useState(initialOpen)
  const messagesRef = useRef<HTMLDivElement>(null)
  const messagesQuery = useQuery({
    queryKey: ['account-support-messages', request.id],
    queryFn: () => readAccountData<SupportMessage[]>(`/api/v1/account/support/${request.id}/messages`),
    enabled: isOpen,
    refetchInterval: isOpen ? 4000 : false,
  })
  const messages = messagesQuery.data?.length ? messagesQuery.data : [
    { id: -request.id, senderType: 'customer' as const, body: request.message, latitude: null, longitude: null, createdAt: request.createdAt },
    ...(request.adminResponse ? [{ id: -request.id - 1, senderType: 'admin' as const, body: request.adminResponse, latitude: null, longitude: null, createdAt: request.updatedAt }] : []),
  ]
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messagesQuery.data])

  async function send(body: string, location?: { latitude: number; longitude: number }) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/v1/account/support/${request.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, ...location }),
      })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Your message could not be sent.')
      setDraft('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-support-messages', request.id] }),
        queryClient.invalidateQueries({ queryKey: ['account-support', userId] }),
      ])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your message could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  function shareLocation() {
    if (!navigator.geolocation) {
      setError('Location sharing is not available in this browser.')
      return
    }
    setBusy(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      (position) => void send('Shared my current location.', { latitude: position.coords.latitude, longitude: position.coords.longitude }),
      (cause) => {
        setBusy(false)
        setError(cause.code === cause.PERMISSION_DENIED ? 'Allow location access in your browser to share a pin.' : 'Your current location could not be found.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }

  return <section className="portal-chat">
    {showToggle && <button type="button" className="portal-chat-toggle" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}><span><Send size={15} /> {isOpen ? 'Close conversation' : 'Open conversation'}</span><span>{request.status.replaceAll('_', ' ')}</span></button>}
    {isOpen && <>
    <div ref={messagesRef} className="portal-chat-messages" aria-label={`Conversation for ${request.subject}`}>
      {messagesQuery.isError && <p className="portal-inline-state" role="alert">{messagesQuery.error.message}</p>}
      {messages.map((entry) => <article className={`portal-chat-message ${entry.senderType === 'customer' ? 'from-customer' : 'from-admin'}`} key={entry.id}>
        <span className="portal-chat-message-by">{entry.senderType === 'customer' ? 'You' : 'KitCulture support'}</span>
        <p>{entry.body}</p>
        <time>{new Date(entry.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</time>
        {entry.latitude !== null && entry.longitude !== null && <GoogleMapView latitude={Number(entry.latitude)} longitude={Number(entry.longitude)} title="Shared location pin" />}
      </article>)}
      {messagesQuery.isPending && <p className="portal-inline-state">Loading conversation…</p>}
    </div>
    {error && <p className="portal-inline-state error-state" role="alert">{error}</p>}
    <form className="portal-chat-compose" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) void send(draft.trim()) }}>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type a message" rows={1} maxLength={2000} aria-label="Write a support message" />
      <div className="portal-chat-compose-actions"><button type="button" className="portal-chat-icon-action" disabled={busy} title="Share your current location" aria-label="Share your current location" onClick={shareLocation}><MapPin size={19} /></button><button type="submit" className="portal-chat-send" disabled={busy || !draft.trim()} title="Send message" aria-label="Send message"><Send size={18} /></button></div>
    </form>
    </>}
  </section>
}

function CustomerAdminConversation({ user, request, search, initialDraft, initialProduct }: { user: Customer; request?: SupportRequest; search: string; initialDraft: string; initialProduct?: ChatKitPreview }) {
  const queryClient = useQueryClient()
  const [conversationId, setConversationId] = useState<number | null>(request?.id ?? null)
  const [draft, setDraft] = useState(initialDraft)
  const [pendingProduct, setPendingProduct] = useState(initialProduct)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (request?.id) setConversationId(request.id)
  }, [request?.id])
  const messagesQuery = useQuery({
    queryKey: ['account-support-messages', conversationId],
    queryFn: () => readAccountData<SupportMessage[]>(`/api/v1/account/support/${conversationId}/messages`),
    enabled: conversationId !== null,
  })
  const messages = messagesQuery.data ?? (request ? [
    { id: -request.id, senderType: 'customer' as const, body: request.message, latitude: null, longitude: null, deliveredAt: null, readAt: null, createdAt: request.createdAt },
    ...(request.adminResponse ? [{ id: -request.id - 1, senderType: 'admin' as const, body: request.adminResponse, latitude: null, longitude: null, deliveredAt: null, readAt: null, createdAt: request.updatedAt }] : []),
  ] : [])
  const visibleMessages = messages.filter((message) => `${message.body} ${message.productName ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))

  useEffect(() => {
    if (messagesRef.current && !search) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messagesQuery.data, search])

  async function send(body: string, location?: { latitude: number; longitude: number }, attachProduct = true) {
    if (!navigator.onLine) {
      setError('You are offline. Your message is still in the composer; reconnect to send it.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await fetch(conversationId
        ? `/api/v1/account/support/${conversationId}/messages`
        : '/api/v1/account/support/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, ...location, ...(attachProduct && pendingProduct ? {
          productName: pendingProduct.name,
          productPrice: pendingProduct.price,
          productImageUrl: pendingProduct.imageUrl ?? undefined,
          productUrl: pendingProduct.productUrl,
        } : {}) }),
      })
      const result = await response.json() as { data?: { id?: number }; error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Your message could not be sent.')
      if (result.data?.id) setConversationId(result.data.id)
      if (attachProduct) {
        setDraft('')
        setPendingProduct(undefined)
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-support-messages', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['account-support', user.id] }),
      ])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your message could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  async function copyMessage(body: string) {
    try {
      await navigator.clipboard.writeText(body)
      setActionMessage('Message copied')
      window.setTimeout(() => setActionMessage(''), 1800)
    } catch {
      setError('Could not copy this message in your browser.')
    }
  }

  async function deleteMessage(messageId: number) {
    if (!conversationId || !window.confirm('Delete this message for both sides?')) return
    setError('')
    try {
      const response = await fetch(`/api/v1/account/support/${conversationId}/messages/${messageId}`, { method: 'DELETE' })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Message could not be deleted.')
      await queryClient.invalidateQueries({ queryKey: ['account-support-messages', conversationId] })
      await queryClient.invalidateQueries({ queryKey: ['account-support', user.id] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Message could not be deleted.')
    }
  }

  function shareLocation() {
    if (!navigator.geolocation) {
      setError('Location sharing is not available in this browser.')
      return
    }
    setBusy(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      (position) => void send('Shared my current location.', { latitude: position.coords.latitude, longitude: position.coords.longitude }, false),
      (cause) => {
        setBusy(false)
        setError(cause.code === cause.PERMISSION_DENIED ? 'Allow location access in your browser to share a pin.' : 'Your current location could not be found.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }

  return <section className="portal-chat portal-direct-thread">
    <div ref={messagesRef} className="portal-chat-messages" aria-label="Messages with KitCulture Admin" aria-live="polite">
      {messagesQuery.isError && <p className="portal-inline-state error-state" role="alert">{messagesQuery.error.message}</p>}
      {messagesQuery.isPending && conversationId !== null && <p className="portal-inline-state">Loading messages…</p>}
      {!messages.length && !messagesQuery.isPending && <div className="portal-direct-empty">Messages you send to KitCulture Admin will appear here.</div>}
      {visibleMessages.map((entry) => <article className={`portal-chat-message ${entry.senderType === 'customer' ? 'from-customer' : 'from-admin'}`} key={entry.id}>
        <p>{entry.body}</p>
        {entry.productName && <Link className="chat-product-preview" to={entry.productUrl ?? '/account/marketplace'}><img src={entry.productImageUrl ?? '/culture-mark.png'} alt="" /><span><strong>{entry.productName}</strong><small>{entry.productPrice !== null && entry.productPrice !== undefined ? money.format(Number(entry.productPrice)) : 'KitCulture kit'}</small></span><ArrowRight size={15} /></Link>}
        <div className="chat-message-actions"><button type="button" title="Copy message" aria-label="Copy message" onClick={() => void copyMessage(entry.body)}><Copy size={14} /></button>{entry.senderType === 'customer' && <button type="button" title="Delete message" aria-label="Delete message" onClick={() => void deleteMessage(entry.id)}><Trash2 size={14} /></button>}</div>
        <span className="portal-chat-message-meta"><time>{new Date(entry.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</time>{entry.senderType === 'customer' && <small className={`portal-chat-receipt${entry.readAt ? ' is-read' : ''}`} title={entry.readAt ? `Read ${new Date(entry.readAt).toLocaleString()}` : entry.deliveredAt ? `Delivered ${new Date(entry.deliveredAt).toLocaleString()}` : 'Sent'}>{entry.readAt ? '✓✓' : entry.deliveredAt ? '✓✓' : '✓'}</small>}</span>
        {entry.latitude !== null && entry.longitude !== null && <GoogleMapView latitude={Number(entry.latitude)} longitude={Number(entry.longitude)} title={entry.senderType === 'customer' ? 'Your shared location' : 'Admin shared location'} />}
      </article>)}
      {search && messages.length > 0 && visibleMessages.length === 0 && <p className="portal-direct-empty">No messages match “{search}”.</p>}
    </div>
    {error && <p className="portal-inline-state error-state" role="alert">{error}</p>}
    {actionMessage && <p className="chat-action-message" role="status">{actionMessage}</p>}
    {pendingProduct && <div className="chat-product-draft"><Link to={pendingProduct.productUrl}><img src={pendingProduct.imageUrl ?? '/culture-mark.png'} alt="" /><span><strong>{pendingProduct.name}</strong><small>{money.format(pendingProduct.price)}</small></span></Link><button type="button" aria-label="Remove kit preview from draft" onClick={() => setPendingProduct(undefined)}><Trash2 size={14} /></button></div>}
    <form className="portal-chat-compose" onSubmit={(event) => { event.preventDefault(); if (draft.trim() && !busy) void send(draft.trim()) }}>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (draft.trim() && !busy) void send(draft.trim()) } }} placeholder="Type a message" rows={1} maxLength={2000} aria-label="Type a message to KitCulture Admin" />
      <div className="portal-chat-compose-actions"><button type="button" className="portal-chat-icon-action" disabled={busy} title="Share your current location" aria-label="Share your current location" onClick={shareLocation}><MapPin size={19} /></button><button type="submit" className="portal-chat-send" disabled={busy || !draft.trim()} title="Send message" aria-label="Send message"><Send size={18} /></button></div>
    </form>
  </section>
}

export function CustomerChatPage({ user }: { user: Customer }) {
  const location = useLocation()
  const navigate = useNavigate()
  const handoff = location.state as { draft?: string; product?: ChatKitPreview; returnTo?: { pathname: string; scrollY: number } } | null
  const queryClient = useQueryClient()
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [adminOnline, setAdminOnline] = useState(false)
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine)
  const [streamConnected, setStreamConnected] = useState(false)
  const chatsQuery = useQuery({
    queryKey: ['account-support', user.id],
    queryFn: () => readAccountData<SupportRequest[]>('/api/v1/account/support'),
  })
  const request = chatsQuery.data?.find((chat) => chat.subject === 'Chat with KitCulture Admin')

  useEffect(() => {
    const stream = new EventSource('/api/v1/account/support/events')
    const onPresence = (event: MessageEvent<string>) => {
      const data = JSON.parse(event.data) as { adminOnline?: boolean }
      setAdminOnline(Boolean(data.adminOnline))
    }
    const onChatMessage = (event: MessageEvent<string>) => {
      const data = JSON.parse(event.data) as { conversationId: number }
      void queryClient.invalidateQueries({ queryKey: ['account-support-messages', data.conversationId] })
      void queryClient.invalidateQueries({ queryKey: ['account-support', user.id] })
    }
    const onMessageReceipt = (event: MessageEvent<string>) => {
      const data = JSON.parse(event.data) as { conversationId: number }
      void queryClient.invalidateQueries({ queryKey: ['account-support-messages', data.conversationId] })
    }
    const onOnline = () => {
      setBrowserOnline(true)
      void queryClient.invalidateQueries({ queryKey: ['account-support', user.id] })
      void queryClient.invalidateQueries({ queryKey: ['account-support-messages'] })
    }
    const onOffline = () => setBrowserOnline(false)
    stream.onopen = () => setStreamConnected(true)
    stream.onerror = () => setStreamConnected(false)
    stream.addEventListener('presence', onPresence as EventListener)
    stream.addEventListener('chat-message', onChatMessage as EventListener)
    stream.addEventListener('message-receipt', onMessageReceipt as EventListener)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      stream.close()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [queryClient, user.id])

  return <div className="customer-portal-content portal-direct-chat-page">
    <section className="portal-direct-chat" aria-label="Conversation with KitCulture Admin">
      <aside className="portal-direct-sidebar" aria-label="Chat list">
        <header><h2>Chats</h2></header>
        <div className="portal-direct-chat-list">
          <div className="portal-direct-chat-item" aria-current="page">
            <span className="portal-direct-avatar">KA</span>
            <span className="portal-direct-contact"><strong>KitCulture Admin</strong><small>{request?.adminResponse ?? request?.message ?? 'Start a conversation with our team'}</small></span>
            {request && <time>{new Date(request.updatedAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}</time>}
          </div>
        </div>
      </aside>
      <div className="portal-direct-panel">
        <header className="portal-direct-header">
          {handoff?.returnTo && <button type="button" className="portal-chat-back-product" onClick={() => navigate(handoff.returnTo!.pathname, { state: { restoreScrollY: handoff.returnTo!.scrollY } })}><ArrowLeft size={16} /> Back to kit</button>}
          <span className="portal-direct-avatar">KA</span>
          <span className="portal-direct-contact"><strong>KitCulture Admin</strong><small className={adminOnline && browserOnline ? 'is-online' : ''}>{!browserOnline ? 'You are offline' : !streamConnected ? 'Reconnecting…' : adminOnline ? 'Online' : 'Offline'}</small></span>
          {searchOpen && <input className="portal-direct-search" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages" aria-label="Search messages" />}
          <button type="button" aria-label={searchOpen ? 'Close message search' : 'Search messages'} title="Search messages" onClick={() => { setSearchOpen((open) => !open); setSearch('') }}><Search size={19} /></button>
        </header>
        {chatsQuery.isError && <p className="portal-inline-state error-state" role="alert">{chatsQuery.error.message}</p>}
        <CustomerAdminConversation key={request?.id ?? 'new'} user={user} request={request} search={search} initialDraft={handoff?.draft ?? ''} initialProduct={handoff?.product} />
      </div>
    </section>
  </div>
}

function PortalOrdersList({
  orders,
  onCancelOrder,
  cancelBusy,
}: {
  orders: PortalOrder[]
  onCancelOrder?: (orderNumber: string) => void
  cancelBusy?: string
}) {
  if (!orders.length) return <div className="catalogue-state"><strong>No orders yet.</strong><span>Your first matchday bag starts in the shop.</span><Link className="button button-green" to="/shop">Browse teams <ArrowRight size={15} /></Link></div>
  return <div className="portal-orders-list">{orders.map((order) => <article className="portal-order-row" key={order.orderNumber}>
    <div className="portal-order-reference"><span>ORDER</span><strong>{order.orderNumber}</strong></div>
    <small className="portal-order-payment">{order.paymentMethod === 'pay_on_delivery' ? 'Pay on Delivery' : 'M-Pesa'}</small>
    <div className="portal-order-date"><span>PLACED</span><strong>{new Date(order.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
    <span className={`portal-status portal-status-${order.status.replaceAll('_', '-')}`}>{order.status.replaceAll('_', ' ')}</span>
    <strong className="portal-order-amount">{money.format(Number(order.total))}</strong>
    <div className="portal-order-actions"><Link to={`/account/orders/${encodeURIComponent(order.orderNumber)}`}>Details <ArrowRight size={14} /></Link>
      <Link to={`/account/track-order/${encodeURIComponent(order.orderNumber)}`}>Track <MapPin size={14} /></Link>
      {order.status === 'pending_payment' && onCancelOrder && <button type="button" disabled={cancelBusy === order.orderNumber} onClick={() => onCancelOrder(order.orderNumber)}>{cancelBusy === order.orderNumber ? 'Cancelling…' : 'Cancel'}</button>}
    </div>
  </article>)}</div>
}

export function CustomerPortalOverview({
  user,
  orders,
  summary,
  ordersLoading,
  ordersError,
  summaryError,
  featuredKits,
  onRetry,
}: {
  user: Customer
  orders: PortalOrder[]
  summary?: AccountSummary
  ordersLoading: boolean
  ordersError?: string
  summaryError?: string
  featuredKits?: ReactNode
  onRetry: () => void
}) {
  const pendingOrders = orders.filter((order) => order.status === 'pending_payment').length
  const delivered = orders.filter((order) => order.status === 'delivered').length
  return <div className="customer-portal-content">
    <PortalHeader kicker="KITCULTURE CUSTOMER PORTAL" title={`Welcome, ${user.fullName.split(/\s+/)[0]}.`} description="Your account, orders, and matchday favourites, all in one place." />
    {(ordersError || summaryError) && <div className="portal-query-error" role="alert"><span>{ordersError ?? summaryError}</span><button type="button" onClick={onRetry}>Retry</button></div>}
    <div className="portal-metrics" aria-label="Account summary">
      {ordersLoading ? Array.from({ length: 4 }, (_, index) => <div className="portal-metric portal-metric-skeleton" key={index} aria-hidden="true"><span /><strong /><small /></div>) : <>
        <Link to="/account/orders" className="portal-metric"><span><Package size={17} /> TOTAL ORDERS</span><strong>{summary?.orderCount ?? orders.length}</strong><small>All your matchday orders</small></Link>
        <Link to="/account/orders" className="portal-metric"><span><ShieldCheck size={17} /> PENDING</span><strong>{pendingOrders}</strong><small>Awaiting order confirmation</small></Link>
        <Link to="/account/orders" className="portal-metric"><span><Package size={17} /> DELIVERED</span><strong>{delivered}</strong><small>Orders marked delivered</small></Link>
        <Link to="/account/wishlist" className="portal-metric"><span><Heart size={17} /> WISHLIST</span><strong>{summary?.wishlistCount ?? '—'}</strong><small>Your saved team colours</small></Link>
      </>}
    </div>
    {featuredKits}
    {summaryError && !ordersError && <p className="portal-secondary-error">Some account summary details could not be loaded. <button type="button" onClick={onRetry}>Retry</button></p>}
  </div>
}

export function CustomerPortalOrdersPage({
  orders,
  loading,
  error,
  onCancelOrder,
  cancelBusy,
  cancelError,
  onRetry,
}: {
  orders: PortalOrder[]
  loading: boolean
  error?: string
  onCancelOrder: (orderNumber: string) => void
  cancelBusy: string
  cancelError: string
  onRetry: () => void
}) {
  return <div className="customer-portal-content">
    <PortalHeader kicker="YOUR ACCOUNT" title="Your orders" description="Track every order and review its status and details." />
    <section className="portal-panel">
      <div className="portal-section-heading"><div><span className="admin-kicker">ORDER HISTORY</span><h2>{orders.length} {orders.length === 1 ? 'order' : 'orders'}</h2></div><button className="portal-retry-link" type="button" onClick={onRetry}>Refresh orders</button></div>
      {loading ? <div className="portal-order-skeletons" aria-label="Loading orders">{[1, 2, 3].map((item) => <div key={item} />)}</div>
        : error ? <div className="portal-inline-state" role="alert">{error} <button type="button" onClick={onRetry}>Retry</button></div>
          : <PortalOrdersList orders={orders} onCancelOrder={onCancelOrder} cancelBusy={cancelBusy} />}
      {cancelError && <AccountMessage error={cancelError} />}
    </section>
  </div>
}

export function CustomerPortalPage({ path, user, onProfileUpdate }: { path: string; user: Customer; onProfileUpdate: (fullName: string, phone: string | null) => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Address | null>(null)
  const [notificationsUnreadOnly, setNotificationsUnreadOnly] = useState(false)
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [paymentBusy, setPaymentBusy] = useState(false)
  const [paymentPhone, setPaymentPhone] = useState('')

  const profileQuery = useQuery({
    queryKey: ['account-profile', user.id],
    queryFn: () => readAccountData<Profile>('/api/v1/account/profile'),
    enabled: path === '/account/profile',
  })
  const addressQuery = useQuery({
    queryKey: ['account-addresses', user.id],
    queryFn: () => readAccountData<Address[]>('/api/v1/account/addresses'),
    enabled: path === '/account/addresses',
  })
  const wishlistQuery = useQuery({
    queryKey: ['account-wishlist', user.id],
    queryFn: () => readAccountData<SavedProduct[]>('/api/v1/account/wishlist'),
    enabled: path === '/account/wishlist',
  })
  const notificationsQuery = useQuery({
    queryKey: ['account-notifications', user.id],
    queryFn: () => readAccountData<CustomerNotification[]>('/api/v1/account/notifications'),
    enabled: path === '/account/notifications',
  })
  const supportQuery = useQuery({
    queryKey: ['account-support', user.id],
    queryFn: () => readAccountData<SupportRequest[]>('/api/v1/account/support'),
    enabled: path === '/account/support',
    refetchInterval: path === '/account/support' ? 8000 : false,
  })
  const supportOrdersQuery = useQuery({
    queryKey: ['account-support-orders', user.id],
    queryFn: () => readAccountData<PortalOrder[]>('/api/v1/orders'),
    enabled: path === '/account/support',
  })
  const orderNumber = decodeURIComponent(path.match(/^\/account\/(?:orders|track-order)\/([^/]+)$/)?.[1] ?? '')
  const orderQuery = useQuery({
    queryKey: ['customer-order', user.id, orderNumber],
    queryFn: () => readAccountData<OrderDetail>(`/api/v1/orders/${encodeURIComponent(orderNumber)}`),
    enabled: Boolean(orderNumber),
    refetchInterval: (query) => ['initiated', 'pending'].includes(query.state.data?.payment?.status ?? '') ? 5000 : false,
  })
  useEffect(() => {
    const savedPayerPhone = orderQuery.data?.payment?.payerPhone
    if (savedPayerPhone) setPaymentPhone(savedPayerPhone)
  }, [orderQuery.data?.payment?.payerPhone])
  const orderTrackingQuery = useQuery({
    queryKey: ['customer-order-tracking', user.id, orderNumber],
    queryFn: () => readAccountData<OrderTracking>(`/api/v1/orders/${encodeURIComponent(orderNumber)}/tracking`),
    enabled: Boolean(orderNumber) && path.includes('/track-order/'),
    refetchInterval: 8000,
  })

  async function retryMpesaPayment() {
    if (!orderNumber) return
    setPaymentBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/v1/orders/${encodeURIComponent(orderNumber)}/mpesa/stk-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: paymentPhone }),
      })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'A new M-Pesa prompt could not be started.')
      setMessage(`A new M-PESA prompt was sent to ${paymentPhone}. Approve it on your phone to continue.`)
      await orderQuery.refetch()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'A new M-Pesa prompt could not be started.')
    } finally {
      setPaymentBusy(false)
    }
  }

  async function updateNotification(url: string, method: 'PATCH' | 'DELETE', successMessage?: string) {
    setNotificationBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' } })
      const result = response.status === 204 ? null : await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result?.error?.message ?? 'Notification could not be updated.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-notifications', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['account-notification-count', user.id] }),
      ])
      if (successMessage) setMessage(successMessage)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Notification could not be updated.')
    } finally {
      setNotificationBusy(false)
    }
  }

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/v1/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: form.get('fullName'), phone: form.get('phone') || null }),
      })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Profile could not be updated.')
      onProfileUpdate(String(form.get('fullName') ?? '').trim(), String(form.get('phone') ?? '').trim() || null)
      setMessage('Your profile has been updated.')
      await queryClient.invalidateQueries({ queryKey: ['account-profile', user.id] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Profile could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  async function submitSupportRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const orderNumber = String(form.get('orderNumber') ?? '').trim()
    try {
      const response = await fetch('/api/v1/account/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: form.get('category'),
          subject: form.get('subject'),
          message: form.get('message'),
          orderNumber: orderNumber || undefined,
        }),
      })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Support request could not be submitted.')
      event.currentTarget.reset()
      setMessage('Your request has been submitted. You can follow its status below.')
      await queryClient.invalidateQueries({ queryKey: ['account-support', user.id] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Support request could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  async function submitAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const numberOrNull = (key: string) => {
      const value = String(form.get(key) ?? '').trim()
      return value ? Number(value) : null
    }
    const payload = {
      label: form.get('label'),
      recipientName: form.get('recipientName'),
      phone: form.get('phone'),
      address: form.get('address'),
      county: form.get('county'),
      town: form.get('town'),
      estate: form.get('estate') || null,
      landmark: form.get('landmark') || null,
      instructions: form.get('instructions') || null,
      latitude: numberOrNull('latitude'),
      longitude: numberOrNull('longitude'),
      isDefault: form.get('isDefault') === 'on',
    }
    try {
      const response = await fetch(editing ? `/api/v1/account/addresses/${editing.id}` : '/api/v1/account/addresses', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Address could not be saved.')
      setEditing(null)
      setMessage(editing ? 'Delivery address updated.' : 'Delivery address saved.')
      await queryClient.invalidateQueries({ queryKey: ['account-addresses', user.id] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Address could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function removeAddress(address: Address) {
    if (!window.confirm(`Remove the ${address.label} delivery address?`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/v1/account/addresses/${address.id}`, { method: 'DELETE' })
      const result = response.status === 204 ? null : await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result?.error?.message ?? 'Address could not be removed.')
      setMessage('Delivery address removed.')
      await queryClient.invalidateQueries({ queryKey: ['account-addresses', user.id] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Address could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  async function removeSavedProduct(product: SavedProduct) {
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/v1/account/wishlist/${product.id}`, { method: 'DELETE' })
      if (!response.ok && response.status !== 204) throw new Error('Saved product could not be removed.')
      setMessage(`${product.name} removed from your wishlist.`)
      await queryClient.invalidateQueries({ queryKey: ['account-wishlist', user.id] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saved product could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const currentPassword = String(form.get('currentPassword') ?? '')
    const newPassword = String(form.get('newPassword') ?? '')
    if (newPassword !== form.get('confirmPassword')) {
      setError('The new passwords do not match.')
      setBusy(false)
      return
    }
    try {
      const response = await fetch('/api/v1/account/security/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const result = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(result.error?.message ?? 'Password could not be changed.')
      setMessage('Password updated and existing sessions revoked. Please sign in again.')
      window.setTimeout(() => navigate('/login', { replace: true }), 1100)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  const pageTitle = path === '/account/profile' ? 'Personal information'
    : path === '/account/addresses' ? 'Delivery addresses'
      : path === '/account/security' ? 'Password & security'
        : path === '/account/wishlist' ? 'Your wishlist'
          : path === '/account/notifications' ? 'Notifications'
            : path === '/account/support' ? 'Help and support'
              : path === '/account/settings' ? 'Account settings'
          : orderNumber ? path.includes('/track-order/') ? 'Order tracking' : 'Order details'
            : 'Customer account'

  return <div className="customer-portal-content">
        <PortalHeader kicker="KITCULTURE CUSTOMER PORTAL" title={pageTitle} description="Your account, your details, and your matchday orders." />
        <AccountMessage error={error} message={message} />

        {path === '/account/profile' && (profileQuery.isPending ? <div className="portal-form-skeleton" aria-label="Loading your profile"><span /><span /><span /></div>
          : profileQuery.isError || !profileQuery.data ? <div className="catalogue-state error-state"><strong>Profile unavailable</strong><span>{profileQuery.error?.message ?? 'Profile details could not be loaded.'}</span><button type="button" className="portal-retry-link" onClick={() => void profileQuery.refetch()}>Retry</button></div>
            : <form key={profileQuery.data.id} className="portal-form" onSubmit={(event) => void submitProfile(event)}>
              <label>Full name<input name="fullName" autoComplete="name" defaultValue={profileQuery.data.fullName} required minLength={2} maxLength={160} /></label>
              <label>Email address<input value={profileQuery.data.email} readOnly aria-describedby="email-status" /></label>
              <small id="email-status">{profileQuery.data.emailVerifiedAt ? 'Email address verified' : 'Email verification is not enabled for this account yet.'}</small>
              <label>Phone number<input name="phone" type="tel" autoComplete="tel" defaultValue={profileQuery.data.phone ?? ''} maxLength={20} /></label>
              <button className="button button-green" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'} <ArrowRight size={15} /></button>
            </form>)}

        {path === '/account/security' && <><p className="portal-note">Changing your password signs out all active customer sessions. Administrator accounts are stored separately and are not affected.</p><form className="portal-form" onSubmit={(event) => void changePassword(event)}>
          <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
          <label>New password<input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
          <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
          <button className="button button-green" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'} <ArrowRight size={15} /></button>
        </form></>}

        {path === '/account/addresses' && <>
          <form key={editing?.id ?? 'new'} className="portal-form portal-address-form" onSubmit={(event) => void submitAddress(event)}>
            <h2>{editing ? 'Edit delivery address' : 'Add delivery address'}</h2>
            <div className="checkout-fields"><label>Label<input name="label" defaultValue={editing?.label ?? ''} placeholder="Home, campus…" required maxLength={80} /></label><label>Recipient<input name="recipientName" defaultValue={editing?.recipientName ?? user.fullName} required maxLength={160} /></label></div>
            <div className="checkout-fields"><label>Phone<input name="phone" type="tel" defaultValue={editing?.phone ?? ''} required maxLength={20} /></label><label>Street address / building<input name="address" defaultValue={editing?.address ?? ''} required maxLength={180} /></label></div>
            <div className="checkout-fields"><label>County<input name="county" defaultValue={editing?.county ?? 'Machakos'} required maxLength={80} /></label><label>Town<input name="town" defaultValue={editing?.town ?? 'Machakos'} required maxLength={100} /></label></div>
            <div className="checkout-fields"><label>Estate<input name="estate" defaultValue={editing?.estate ?? ''} maxLength={100} /></label><label>Landmark<input name="landmark" defaultValue={editing?.landmark ?? ''} maxLength={180} /></label></div>
            <label>Delivery instructions<input name="instructions" defaultValue={editing?.instructions ?? ''} maxLength={500} /></label>
            <div className="checkout-fields"><label>Latitude <span>(optional)</span><input name="latitude" type="number" step="any" min="-90" max="90" defaultValue={editing?.latitude ?? ''} /></label><label>Longitude <span>(optional)</span><input name="longitude" type="number" step="any" min="-180" max="180" defaultValue={editing?.longitude ?? ''} /></label></div>
            <label className="portal-checkbox"><input name="isDefault" type="checkbox" defaultChecked={editing?.isDefault ?? false} /> Set as my default delivery address</label>
            <div className="portal-form-actions"><button className="button button-green" type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add address'}</button>{editing && <button type="button" className="button button-outline" onClick={() => setEditing(null)}>Cancel edit</button>}</div>
          </form>
          {addressQuery.isPending ? <div className="portal-form-skeleton" aria-label="Loading your addresses"><span /><span /><span /></div>
            : addressQuery.isError ? <div className="catalogue-state error-state"><strong>Addresses unavailable</strong><span>{addressQuery.error.message}</span><button type="button" className="portal-retry-link" onClick={() => void addressQuery.refetch()}>Retry</button></div>
              : addressQuery.data?.length ? <div className="portal-address-list">{addressQuery.data.map((address) => <article className="portal-address-card" key={address.id}>
                <div><strong>{address.label} {address.isDefault && <span className="portal-default">DEFAULT</span>}</strong><span>{address.recipientName} · {address.phone}</span><span>{address.address}, {address.town}, {address.county}{address.estate ? ` · ${address.estate}` : ''}</span></div>
                <div className="portal-row-actions"><button type="button" disabled={busy} onClick={() => setEditing(address)}>Edit</button><button type="button" disabled={busy} onClick={() => void removeAddress(address)}>Remove</button></div>
              </article>)}</div>
                : <div className="catalogue-state"><strong>No saved delivery addresses.</strong><span>Add an address above to keep checkout details ready.</span></div>}
        </>}

        {path === '/account/wishlist' && (wishlistQuery.isPending ? <div className="portal-wishlist-skeleton" aria-label="Loading your wishlist">{[1, 2, 3].map((item) => <div key={item} />)}</div>
          : wishlistQuery.isError ? <div className="catalogue-state error-state"><strong>Wishlist unavailable</strong><span>{wishlistQuery.error.message}</span><button type="button" className="portal-retry-link" onClick={() => void wishlistQuery.refetch()}>Retry</button></div>
            : wishlistQuery.data?.length ? <div className="portal-wishlist-grid">{wishlistQuery.data.map((product) => <article className="portal-wishlist-card" key={product.id}>
              <Link to={`/account/marketplace/products/${product.slug}`}>{product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <div className="product-image-empty"><span>KC</span></div>}<span className="product-category">{money.format(Number(product.price))}</span><strong>{product.name}</strong></Link>
              <button type="button" disabled={busy} onClick={() => void removeSavedProduct(product)}>Remove from wishlist</button>
            </article>)}</div>
              : <div className="catalogue-state"><strong>Your wishlist is empty.</strong><span>Save jerseys from the shop to keep your favourites here.</span><Link className="button button-green" to="/shop">Browse jerseys <ArrowRight size={15} /></Link></div>)}

        {orderNumber && (orderQuery.isPending ? <div className="catalogue-state"><strong>Loading your order…</strong></div>
          : orderQuery.isError || !orderQuery.data ? <div className="catalogue-state error-state"><strong>Order unavailable</strong><span>{orderQuery.error?.message ?? 'This order could not be found.'}</span></div>
            : <div className="portal-order-detail">
              <div className="portal-order-summary"><strong>{orderQuery.data.orderNumber}</strong><span>{orderQuery.data.status.replaceAll('_', ' ')} · {orderQuery.data.paymentMethod === 'pay_on_delivery' ? 'Pay on Delivery' : 'M-Pesa'} · {new Date(orderQuery.data.createdAt).toLocaleDateString('en-KE')}</span></div>
              <Link className="button button-green portal-track-link" to={`/account/track-order/${encodeURIComponent(orderQuery.data.orderNumber)}`}><MapPin size={16} /> Track delivery</Link>
              {path.includes('/track-order/') && <section className="portal-panel portal-tracking-panel">
                <div className="portal-section-heading"><div><span className="admin-kicker">LIVE DELIVERY UPDATES</span><h2>{orderTrackingQuery.data?.status.replaceAll('_', ' ') ?? 'Delivery tracking'}</h2></div><button className="portal-retry-link" type="button" onClick={() => void orderTrackingQuery.refetch()}>Refresh map</button></div>
                {orderTrackingQuery.isPending ? <p className="portal-inline-state">Loading delivery locations…</p>
                  : orderTrackingQuery.isError || !orderTrackingQuery.data ? <p className="portal-inline-state error-state" role="alert">{orderTrackingQuery.error?.message ?? 'Delivery tracking could not be loaded.'}</p>
                    : <>
                      <p className="portal-note">The map refreshes automatically. Courier location appears when the KitCulture team shares an update in your chat.</p>
                      {orderTrackingQuery.data.courier && orderTrackingQuery.data.courier.latitude !== null && orderTrackingQuery.data.courier.longitude !== null
                        ? <GoogleMapView
                          latitude={orderTrackingQuery.data.courier.latitude}
                          longitude={orderTrackingQuery.data.courier.longitude}
                          destination={orderTrackingQuery.data.destination.latitude !== null && orderTrackingQuery.data.destination.longitude !== null
                            ? { latitude: orderTrackingQuery.data.destination.latitude, longitude: orderTrackingQuery.data.destination.longitude }
                            : undefined}
                          title={`Latest courier location · ${new Date(orderTrackingQuery.data.courier.updatedAt).toLocaleString('en-KE')}`}
                        />
                        : orderTrackingQuery.data.destination.latitude !== null && orderTrackingQuery.data.destination.longitude !== null
                          ? <GoogleMapView latitude={orderTrackingQuery.data.destination.latitude} longitude={orderTrackingQuery.data.destination.longitude} title={`Delivery destination${orderTrackingQuery.data.destination.town ? ` · ${orderTrackingQuery.data.destination.town}` : ''}`} />
                          : <p className="portal-inline-state">No delivery pin was saved for this order. The map will appear once a delivery location is available.</p>}
                      {orderTrackingQuery.data.destination.county && <p className="portal-map-caption">Delivery area: {orderTrackingQuery.data.destination.town ? `${orderTrackingQuery.data.destination.town}, ` : ''}{orderTrackingQuery.data.destination.county}</p>}
                      {orderTrackingQuery.data.destination.accuracy !== null
                        ? <p className="portal-pin-accuracy">Delivery pin precision: about {Math.round(orderTrackingQuery.data.destination.accuracy)} m radius. GPS accuracy varies by device and surroundings.</p>
                        : <p className="portal-pin-accuracy">Pin accuracy was not reported. Confirm the map marker before relying on directions.</p>}
                    </>}
              </section>}
              <div className="portal-order-items">{orderQuery.data.items.map((item, index) => <article key={`${item.name}-${item.size}-${index}`}><span>{item.name} · Size {item.size} × {item.quantity}</span><strong>{money.format(Number(item.unitPrice) * item.quantity)}</strong></article>)}</div>
              <div className="portal-order-total"><span>Subtotal</span><strong>{money.format(Number(orderQuery.data.subtotal))}</strong><span>Delivery</span><strong>{money.format(Number(orderQuery.data.deliveryFee))}</strong><span>Total</span><strong>{money.format(Number(orderQuery.data.total))}</strong></div>
              {orderQuery.data.paymentMethod === 'mpesa' && <section className="portal-panel portal-payment-status">
                <div className="portal-section-heading"><div><span className="admin-kicker">M-PESA PAYMENT</span><h2>{orderQuery.data.payment?.status === 'succeeded' ? 'Payment verified' : orderQuery.data.payment?.status === 'pending' || orderQuery.data.payment?.status === 'initiated' ? 'Waiting for payment' : orderQuery.data.payment?.status === 'failed' ? 'Payment not completed' : orderQuery.data.payment?.status === 'cancelled' ? 'Payment cancelled' : orderQuery.data.payment?.status === 'expired' ? 'Prompt expired' : orderQuery.data.payment?.status === 'requires_review' ? 'Payment under review' : 'Payment prompt not started'}</h2></div><ShieldCheck size={18} /></div>
                {orderQuery.data.payment?.providerReceipt && <p><strong>Receipt:</strong> {orderQuery.data.payment.providerReceipt}</p>}
                {orderQuery.data.payment?.payerPhone && <p><strong>Paying phone:</strong> {orderQuery.data.payment.payerPhone.startsWith('+') ? orderQuery.data.payment.payerPhone : `+${orderQuery.data.payment.payerPhone}`}</p>}
                {orderQuery.data.payment?.transactionAt && <p><strong>Paid at:</strong> {new Date(orderQuery.data.payment.transactionAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</p>}
                <p>{orderQuery.data.payment?.verificationMessage ?? 'Payment is only confirmed after Daraja verifies the transaction against this order and your account phone.'}</p>
                {orderQuery.data.status === 'pending_payment' && orderQuery.data.payment?.status === 'pending' && <p role="status">The payment request is still active. Approve it on your phone or wait for the verified payment status; do not request another prompt while this one is unresolved.</p>}
                {orderQuery.data.status === 'pending_payment' && (!orderQuery.data.payment || ['failed', 'cancelled', 'expired'].includes(orderQuery.data.payment.status)) && <>
                  <KenyanPhoneInput label="Phone number to pay from" value={paymentPhone} onChange={setPaymentPhone} />
                  <button type="button" className="button button-green" disabled={paymentBusy || !paymentPhone} onClick={() => void retryMpesaPayment()}>{paymentBusy ? 'Requesting prompt…' : orderQuery.data.payment ? 'Retry payment prompt' : 'Send payment prompt'} <Smartphone size={15} /></button>
                </>}
              </section>}
            </div>)}

        {path === '/account/notifications' && <section className="portal-panel portal-notifications">
          <div className="portal-section-heading"><div><span className="admin-kicker">YOUR INBOX</span><h2>{notificationsQuery.data?.filter((notification) => !notification.readAt).length ?? 0} unread</h2></div>
            <div className="portal-notification-actions"><div className="portal-notification-filter" role="group" aria-label="Filter notifications"><button type="button" aria-pressed={!notificationsUnreadOnly} onClick={() => setNotificationsUnreadOnly(false)}>All</button><button type="button" aria-pressed={notificationsUnreadOnly} onClick={() => setNotificationsUnreadOnly(true)}>Unread</button></div>
              <button type="button" className="portal-retry-link" disabled={notificationBusy || !notificationsQuery.data?.some((notification) => !notification.readAt)} onClick={() => void updateNotification('/api/v1/account/notifications/read-all', 'PATCH', 'All notifications marked as read.')}>Mark all read</button>
              <button type="button" className="portal-retry-link" onClick={() => void notificationsQuery.refetch()}>Refresh</button>
            </div>
          </div>
          {notificationsQuery.isPending ? <div className="portal-order-skeletons" aria-label="Loading notifications">{[1, 2, 3].map((item) => <div key={item} />)}</div>
            : notificationsQuery.isError ? <div className="catalogue-state error-state"><strong>Notifications unavailable</strong><span>{notificationsQuery.error.message}</span><button type="button" className="portal-retry-link" onClick={() => void notificationsQuery.refetch()}>Retry</button></div>
              : (() => {
                const notifications = (notificationsQuery.data ?? []).filter((notification) => !notificationsUnreadOnly || !notification.readAt)
                return notifications.length ? <div className="portal-notification-list">{notifications.map((notification) => <article className={notification.readAt ? '' : 'is-unread'} key={notification.id}>
                  <div className="portal-notification-copy"><div><span className="product-category">{notification.type === 'order' ? 'ORDER UPDATE' : notification.type === 'support' ? 'SUPPORT UPDATE' : 'KITCULTURE NEWS'}</span><h3>{notification.title}</h3></div><time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString('en-KE')}</time></div>
                  <p>{notification.body}</p>
                  <div className="portal-notification-row-actions">{notification.href && <Link to={notification.href}>{notification.type === 'order' ? 'View order' : notification.type === 'support' ? 'View support' : 'Open update'} <ArrowRight size={14} /></Link>}
                    {!notification.readAt && <button type="button" className="portal-retry-link" disabled={notificationBusy} onClick={() => void updateNotification(`/api/v1/account/notifications/${notification.id}/read`, 'PATCH')}>Mark read</button>}
                    <button type="button" className="portal-retry-link" disabled={notificationBusy} onClick={() => void updateNotification(`/api/v1/account/notifications/${notification.id}`, 'DELETE')}>Dismiss</button>
                  </div>
                </article>)}</div>
                  : <div className="catalogue-state"><strong>{notificationsUnreadOnly ? 'You are all caught up.' : 'No notifications yet.'}</strong><span>{notificationsUnreadOnly ? 'New updates will appear here.' : 'Order confirmations and KitCulture announcements will appear here.'}</span></div>
              })()}
        </section>}
        {path === '/account/support' && <>
          <form className="portal-form portal-support-form" onSubmit={(event) => void submitSupportRequest(event)}>
            <h2>How can we help?</h2>
            <p className="portal-note">Start a conversation with the KitCulture team. Reply here, share a location pin, and receive delivery updates in the same chat.</p>
            <label>Topic<select name="category" required defaultValue="order"><option value="order">Order</option><option value="payment">Payment</option><option value="delivery">Delivery</option><option value="product">Product</option><option value="account">Account</option><option value="other">Other</option></select></label>
            <label>Related order (optional)<select name="orderNumber" defaultValue=""><option value="">No related order</option>{(supportOrdersQuery.data ?? []).map((order) => <option key={order.orderNumber} value={order.orderNumber}>{order.orderNumber} · {order.status.replaceAll('_', ' ')}</option>)}</select></label>
            {supportOrdersQuery.isError && <p className="portal-inline-state">Your order references could not be loaded: {supportOrdersQuery.error.message}. You can still submit a general request.</p>}
            <label>Subject<input name="subject" required minLength={3} maxLength={120} /></label>
            <label>First message<textarea name="message" required minLength={10} maxLength={2000} rows={5} placeholder="Tell us what happened and how we can help." /></label>
            <button className="button button-green" type="submit" disabled={busy}>{busy ? 'Starting chat…' : 'Start conversation'} <ArrowRight size={15} /></button>
          </form>
          <section className="portal-panel portal-support-list">
            <div className="portal-section-heading"><div><span className="admin-kicker">YOUR REQUESTS</span><h2>Support history</h2></div><button className="portal-retry-link" type="button" onClick={() => void supportQuery.refetch()}>Refresh</button></div>
            {supportQuery.isPending ? <div className="catalogue-state"><strong>Loading support requests…</strong></div>
              : supportQuery.isError ? <div className="catalogue-state error-state"><strong>Support history unavailable</strong><span>{supportQuery.error.message}</span><button type="button" className="portal-retry-link" onClick={() => void supportQuery.refetch()}>Retry</button></div>
                : supportQuery.data?.length ? <div className="portal-support-requests">{supportQuery.data.map((request) => <article key={request.id}>
                  <div className="portal-support-heading"><div><span className="product-category">{request.category}{request.orderNumber ? ` · ${request.orderNumber}` : ''}</span><h3>{request.subject}</h3></div><span className={`portal-status portal-status-${request.status.replaceAll('_', '-')}`}>{request.status.replaceAll('_', ' ')}</span></div>
                  <p>{request.message}</p><small>Started {new Date(request.createdAt).toLocaleString('en-KE')}</small>
                  <SupportConversation request={request} userId={user.id} />
                </article>)}</div>
                  : <div className="catalogue-state"><strong>No support requests yet.</strong><span>Use the form above whenever you need help.</span></div>}
          </section>
        </>}
        {path === '/account/settings' && <section className="portal-panel portal-settings-links"><Link to="/account/profile"><UserRound size={18} /><span><strong>Personal information</strong><small>Manage your name and phone number.</small></span><ArrowRight size={15} /></Link><Link to="/account/security"><LockKeyhole size={18} /><span><strong>Password & security</strong><small>Update your password and secure your account.</small></span><ArrowRight size={15} /></Link><Link to="/account/addresses"><MapPin size={18} /><span><strong>Delivery addresses</strong><small>Manage saved delivery locations.</small></span><ArrowRight size={15} /></Link></section>}
  </div>
}
