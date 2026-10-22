import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export function AuthBrandPanel({ audience = 'customer' }: { audience?: 'customer' | 'admin' }) {
  const isAdmin = audience === 'admin'
  return <section className="auth-brand-panel" aria-label={isAdmin ? 'KitCulture administration' : 'KitCulture'}>
    <Link to="/" className="auth-brand-mark"><img src="/culture-mark.png" alt="" /><span>KitCulture</span></Link>
    <div className="auth-brand-copy"><span>{isAdmin ? 'KITCULTURE OPERATIONS' : 'BUILT FOR THE STANDS. READY FOR THE STREET.'}</span><h2>{isAdmin ? <>Matchday starts<br /><em>behind the scenes.</em></> : <>Your colours.<br /><em>Your culture.</em></>}</h2><p>{isAdmin ? 'Keep the catalogue, orders, and supporter experience in sync.' : 'Made for every minute, and everyone who carries the game with them.'}</p></div>
    <span className="auth-brand-footer">MACHAKOS-BORN · MATCHDAY-READY</span>
  </section>
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-layout">
    <AuthBrandPanel />
    <section className="auth-content">
      <div className="auth-content-inner">
        <Link className="auth-return-link" to="/"><ArrowLeft size={16} /> <span>Back to the shop</span></Link>
        {children}
      </div>
      <span className="auth-legal">© 2026 KitCulture · Your account, kept secure.</span>
    </section>
  </main>
}
