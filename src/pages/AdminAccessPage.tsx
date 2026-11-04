import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BarChart3, Boxes, CircleDollarSign, Crown, LogIn, Megaphone, MonitorCog, ShoppingCart, ShieldCheck } from 'lucide-react'
import '../admin-access.css'

const portals = [
  { title: 'Super Admin', detail: 'System-wide administration and management', bullets: ['Administrators and roles', 'Permissions and governance', 'Security oversight and reports'], href: '/super-admin/login', icon: Crown, tone: 'violet' },
  { title: 'IT Admin', detail: 'IT operations and technical monitoring', bullets: ['System monitoring', 'Infrastructure operations', 'Security operations'], href: '/operations', icon: MonitorCog, tone: 'blue' },
  { title: 'Sales & Customer Management', detail: 'Orders, products and customers', bullets: ['Orders management', 'Product management', 'Customer support'], href: '/admin/login', icon: ShoppingCart, tone: 'green' },
  { title: 'Finance Admin', detail: 'Payments, revenue and financial management', bullets: ['Payment management', 'Revenue analytics', 'Financial reports'], href: '/finance-admin/login', icon: CircleDollarSign, tone: 'orange' },
  { title: 'Inventory Admin', detail: 'Stock and inventory management', bullets: ['Stock management', 'Stock movements', 'Inventory analytics'], href: '/inventory-admin/login', icon: Boxes, tone: 'teal' },
  { title: 'Marketing Admin', detail: 'Campaigns and marketing activities', bullets: ['Campaign management', 'Customer notifications', 'Marketing analytics'], href: '/marketing-admin/login', icon: Megaphone, tone: 'pink' },
  { title: 'Content Admin', detail: 'Products and content operations', bullets: ['Catalogue content', 'Categories and taxonomy', 'Homepage content'], href: '/content-admin/login', icon: BarChart3, tone: 'indigo' },
] as const

async function request<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? 'Administrator activation failed.')
  return payload.data as T
}

function AccessCard({ portal }: { portal: typeof portals[number] }) {
  const Icon = portal.icon
  return <article className={`access-card tone-${portal.tone}`}><div className="access-card-heading"><span className="access-card-icon"><Icon size={25} /></span><div><h2>{portal.title}</h2><p>{portal.detail}</p></div></div><ul>{portal.bullets.map((bullet) => <li key={bullet}><ShieldCheck size={14} />{bullet}</li>)}</ul><Link className="access-card-button" to={portal.href}> <LogIn size={16} /> Login</Link></article>
}

export function AdminAccessPage() {
  return <main className="admin-access-page"><section className="admin-access-frame"><header className="admin-access-hero"><div><span className="access-eyebrow">KITCULTURE ADMINISTRATION</span><h1>KitCulture Administrator Portals</h1><p>Access your dedicated administration portal below.</p></div><div className="access-hero-art" aria-hidden="true"><ShoppingCart size={78} /></div><em>Together for a better<br />shopping experience</em></header><div className="access-grid">{portals.map((portal) => <AccessCard key={portal.title} portal={portal} />)}</div><p className="access-footer">New administrators should use the activation link in their invitation email.</p></section></main>
}

export function AdminActivationPage() {
  const location = useLocation()
  const activationParams = new URLSearchParams(location.search)
  const token = activationParams.get('token') ?? ''
  const [roleNumber, setRoleNumber] = useState(activationParams.get('roleNumber') ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [activated, setActivated] = useState(Boolean(activationParams.get('roleNumber')))
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError('')
    try { await request('/api/v1/admin/activate', { token, roleNumber }); setActivated(true) } catch (issue) { setError(issue instanceof Error ? issue.message : 'Activation failed.') } finally { setBusy(false) }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    setBusy(true); setError('')
    try { await request('/api/v1/admin/activate/password', { token, roleNumber, password, confirmPassword }); setSent(true) } catch (issue) { setError(issue instanceof Error ? issue.message : 'Password setup failed.') } finally { setBusy(false) }
  }

  return <main className="admin-access-page"><section className="activation-card"><Link className="activation-brand" to="/admin/access"><ShieldCheck size={20} /> KitCulture Administration</Link><span className="access-eyebrow">SECURE ROLE ACTIVATION</span><h1>{sent ? 'Verify your email address' : activated ? 'Create your private password' : 'Activate your administrator role'}</h1>{sent ? <><p>Your password has been set. Check the invited email address and follow the verification link before signing in.</p><Link className="activation-button" to="/admin/access">Return to portal access</Link></> : !token ? <p className="activation-error">This activation page requires the secure invitation link from your email.</p> : activated ? <form onSubmit={(event) => void changePassword(event)}><p>Your assigned role number was accepted. Choose a new password before administrator sign-in is enabled.</p><label>Role number<input value={roleNumber} onChange={(event) => setRoleNumber(event.target.value)} autoComplete="username" required /></label><label>New password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={14} maxLength={128} autoComplete="new-password" required /></label><label>Confirm new password<input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" minLength={14} maxLength={128} autoComplete="new-password" required /></label>{error && <p className="activation-error" role="alert">{error}</p>}<button className="activation-button" type="submit" disabled={busy}>{busy ? 'Saving password...' : 'Save password and send verification'}</button></form> : <form onSubmit={(event) => void activate(event)}><p>Enter the role number from your invitation. It is the temporary activation credential for this account.</p><label>Assigned role number<input value={roleNumber} onChange={(event) => setRoleNumber(event.target.value)} autoComplete="username" required placeholder="FIN-0001" /></label>{error && <p className="activation-error" role="alert">{error}</p>}<button className="activation-button" type="submit" disabled={busy}>{busy ? 'Activating role...' : 'Activate role number'}</button></form>}</section></main>
}