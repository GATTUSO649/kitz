import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, ChevronDown, CircleHelp, Heart, Home, LogOut, MapPin, Menu, MessageCircle, Package, Settings, ShieldCheck, ShoppingCart, Trophy, UserRound, X } from 'lucide-react'
import { Link } from 'react-router-dom'

type Customer = { id: number; email: string; fullName: string }

const sections = [
  {
    label: 'SHOPPING',
    items: [
      { to: '/account/dashboard', label: 'Dashboard', Icon: Home },
      { to: '/account/marketplace', label: 'Marketplace', Icon: Trophy },
      { to: '/account/cart', label: 'Shopping Bag', Icon: ShoppingCart },
      { to: '/account/orders', label: 'My Orders', Icon: Package },
      { to: '/account/wishlist', label: 'My Wishlist', Icon: Heart },
    ],
  },
  {
    label: 'MY ACCOUNT',
    items: [
      { to: '/account/profile', label: 'Personal Information', Icon: UserRound },
      { to: '/account/addresses', label: 'Delivery Addresses', Icon: MapPin },
      { to: '/account/security', label: 'Security', Icon: ShieldCheck },
      { to: '/account/settings', label: 'Account Settings', Icon: Settings },
    ],
  },
  {
    label: 'SUPPORT',
    items: [
      { to: '/account/notifications', label: 'Notifications', Icon: Bell },
      { to: '/account/chat', label: 'Chat', Icon: MessageCircle },
      { to: '/account/support', label: 'Help and support', Icon: CircleHelp },
    ],
  },
] as const

export function CustomerPortalLayout({
  currentPath,
  user,
  itemCount,
  onSignOut,
  children,
}: {
  currentPath: string
  user: Customer
  itemCount: number
  onSignOut: () => void
  children: ReactNode
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const initials = user.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  const unreadNotificationsQuery = useQuery({
    queryKey: ['account-notification-count', user.id],
    queryFn: async () => {
      const response = await fetch('/api/v1/account/notifications/unread-count')
      const result = await response.json() as { data?: { count: number }; error?: { message?: string } }
      if (!response.ok || result.data === undefined) throw new Error(result.error?.message ?? 'Notification count unavailable.')
      return result.data.count
    },
    refetchInterval: 30_000,
  })
  const unreadNotifications = unreadNotificationsQuery.data ?? 0

  return <div className="portal-shell" style={{ backgroundImage: 'url(https://i.pinimg.com/736x/81/13/c2/8113c26c3d058b2beef401b32e1d3bde.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
    {drawerOpen && <button className="portal-drawer-scrim" type="button" aria-label="Close customer navigation" onClick={() => setDrawerOpen(false)} />}
    <aside className={drawerOpen ? 'portal-sidebar is-open' : 'portal-sidebar'}>
      <Link to="/account/dashboard" className="portal-sidebar-brand" onClick={() => setDrawerOpen(false)}><img src="/culture-mark.png" alt="" /><span>KitCulture</span><small>PORTAL</small></Link>
      <nav aria-label="Customer portal">
        {sections.map(({ label, items }) => <section className="portal-nav-group" key={label}>
          <h2>{label}</h2>
          {items.map(({ to, label: itemLabel, Icon }) => {
            const active = currentPath === to || to === '/account/orders' && /^\/account\/(?:orders|track-order)\//.test(currentPath) || to === '/account/marketplace' && /^\/account\/marketplace(?:\/|$)/.test(currentPath)
            return <Link key={to} to={to} aria-current={active ? 'page' : undefined} className={active ? 'active' : ''} onClick={() => setDrawerOpen(false)}><Icon size={17} /><span>{itemLabel}</span></Link>
          })}
        </section>)}
      </nav>
      <Link className="portal-continue-shopping" to="/account/marketplace" onClick={() => setDrawerOpen(false)}>Explore Marketplace <span aria-hidden="true">↗</span></Link>
      <div className="portal-sidebar-identity"><span className="portal-avatar" aria-hidden="true">{initials}</span><span><strong>{user.fullName}</strong><small>{user.email}</small></span><button type="button" aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOut size={16} /></button></div>
    </aside>
    <div className="portal-workspace">
      <header className="portal-topbar">
        <button type="button" className="portal-menu-toggle" aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={drawerOpen} onClick={() => setDrawerOpen((open) => !open)}>{drawerOpen ? <X size={20} /> : <Menu size={20} />}</button>
        <div className="portal-topbar-title"><span>KitCulture</span><small>CUSTOMER PORTAL</small></div>
        <div className="portal-topbar-actions">
          <Link to="/account/notifications" className="portal-notification-link" aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`} title="Notifications"><Bell size={17} />{unreadNotifications > 0 && <span className="portal-cart-count">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</Link>
          <Link to="/account/cart" className="portal-cart-link" aria-label={`Shopping cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`} title="Shopping cart"><ShoppingCart size={17} /><span className="portal-cart-count">{itemCount}</span></Link>
          <Link to="/account/support" aria-label="Help and support" title="Help and support"><CircleHelp size={17} /></Link>
          <div className="portal-account-menu">
            <button type="button" aria-label="Customer account menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}><span className="portal-avatar">{initials}</span><ChevronDown size={14} /></button>
            {accountMenuOpen && <div className="portal-account-dropdown"><strong>{user.fullName}</strong><small>{user.email}</small><Link to="/account/profile" onClick={() => setAccountMenuOpen(false)}><UserRound size={15} /> Personal information</Link><button type="button" onClick={onSignOut}><LogOut size={15} /> Sign out</button></div>}
          </div>
        </div>
      </header>
      <main className="portal-main">{children}</main>
      <footer className="portal-footer"><span>KitCulture Customer Portal</span><Link to="/account/marketplace">Continue Shopping <span aria-hidden="true">↗</span></Link></footer>
    </div>
  </div>
}
