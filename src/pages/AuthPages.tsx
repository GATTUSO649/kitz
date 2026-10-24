import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

export function CustomerAuthForm({
  mode,
  busy,
  error,
  fieldErrors,
  onFieldChange,
  registered,
  email,
  returnTo,
  onSubmit,
}: {
  mode: 'login' | 'register'
  busy: boolean
  error: string
  fieldErrors: Partial<Record<'fullName' | 'email' | 'password' | 'passwordConfirmation', string>>
  onFieldChange: (field: 'fullName' | 'email' | 'password' | 'passwordConfirmation') => void
  registered: boolean
  email: string
  returnTo: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [transitionPhase, setTransitionPhase] = useState<'cover' | 'reveal' | null>(null)
  const isRegister = mode === 'register'
  const authQuery = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''
  const targetModePath = isRegister ? `/login${authQuery}` : `/signup${authQuery}`
  const transitionDurationMs = 620

  function switchMode(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    if (transitionPhase) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      navigate(targetModePath)
      return
    }
    setTransitionPhase('cover')
    window.setTimeout(() => {
      navigate(targetModePath)
      setTransitionPhase('reveal')
      window.setTimeout(() => setTransitionPhase(null), transitionDurationMs)
    }, transitionDurationMs)
  }

  return <form className={`auth-card auth-card-split auth-card-${mode}${transitionPhase ? ' is-transitioning' : ''}`} data-transition-phase={transitionPhase ?? undefined} onSubmit={onSubmit} noValidate>
    <aside className="auth-card-side">
      <div className="auth-card-side-copy">
        <Link to="/" className="auth-card-brand"><img src="/culture-mark.png" alt="" /><span>KitCulture</span></Link>
        <span className="auth-card-side-kicker">{isRegister ? 'JOIN THE CULTURE' : 'WELCOME BACK'}</span>
        <h2>{isRegister ? <>Your colours.<br /><em>Your culture.</em></> : <>Good to see<br /><em>you again.</em></>}</h2>
        <p>{isRegister ? 'One account for your orders, favourite kits, and matchday essentials.' : 'Your orders, favourite kits, and delivery details are right where you left them.'}</p>
      </div>
      <div className="auth-card-side-switch"><span>{isRegister ? 'Already have an account?' : 'New to KitCulture?'}</span><Link to={targetModePath} onClick={switchMode}>{isRegister ? 'Sign in' : 'Create account'} <ArrowRight size={15} /></Link></div>
    </aside>
    <div className={`auth-card-fields auth-card-fields-${mode}`}>
    <span className="auth-kicker">{isRegister ? 'CREATE ACCOUNT' : 'MEMBER SIGN IN'}</span>
    <h1>{isRegister ? 'Create your account.' : 'Sign in to KitCulture.'}</h1>
    <p className="auth-description">{isRegister ? 'Add your details to get started.' : 'Sign in to continue to your account.'}</p>
    {registered && !isRegister && <p className="auth-feedback success" role="status">Account created. Sign in with your new details to continue.</p>}
    {isRegister && <label>Full name<input autoComplete="name" name="fullName" required minLength={2} maxLength={160} aria-invalid={Boolean(fieldErrors.fullName)} aria-describedby={fieldErrors.fullName ? 'auth-full-name-error' : undefined} onChange={() => onFieldChange('fullName')} />{fieldErrors.fullName && <small className="auth-field-error" id="auth-full-name-error">{fieldErrors.fullName}</small>}</label>}
    <label>Email address<input autoComplete="email" name="email" type="email" required maxLength={254} defaultValue={email} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined} onChange={() => onFieldChange('email')} />{fieldErrors.email && <small className="auth-field-error" id="auth-email-error">{fieldErrors.email}</small>}</label>
    <label className="auth-password-field">Password<span className="auth-password-control"><input autoComplete={isRegister ? 'new-password' : 'current-password'} name="password" type={showPassword ? 'text' : 'password'} required minLength={isRegister ? 12 : 1} maxLength={128} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'auth-password-error' : isRegister ? 'auth-password-hint' : undefined} onChange={() => onFieldChange('password')} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>{isRegister && <small id="auth-password-hint">At least 12 characters; no more than 72 UTF-8 bytes.</small>}{fieldErrors.password && <small className="auth-field-error" id="auth-password-error">{fieldErrors.password}</small>}</label>
    {!isRegister && <div className="auth-forgot-row"><Link to="/forgot-password">Forgot password?</Link></div>}
    {isRegister && <label className="auth-password-field">Confirm password<span className="auth-password-control"><input autoComplete="new-password" name="passwordConfirmation" type={showConfirmation ? 'text' : 'password'} required minLength={12} maxLength={128} aria-invalid={Boolean(fieldErrors.passwordConfirmation)} aria-describedby={fieldErrors.passwordConfirmation ? 'auth-password-confirmation-error' : undefined} onChange={() => onFieldChange('passwordConfirmation')} /><button type="button" aria-label={showConfirmation ? 'Hide confirmation password' : 'Show confirmation password'} aria-pressed={showConfirmation} onClick={() => setShowConfirmation((visible) => !visible)}>{showConfirmation ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>{fieldErrors.passwordConfirmation && <small className="auth-field-error" id="auth-password-confirmation-error">{fieldErrors.passwordConfirmation}</small>}</label>}
    {error && <p className="auth-feedback" role="alert">{error}</p>}
    <button className="button button-green auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></button>
    </div>
  </form>
}

export function CustomerAuthInfoPage({ kind }: { kind: 'forgot' | 'reset' | 'verify' }) {
  const copy = {
    forgot: { kicker: 'PASSWORD RECOVERY', title: 'Reset your password.', text: 'Secure password recovery is not available yet because account email delivery has not been configured. Your account is unchanged.' },
    reset: { kicker: 'PASSWORD RECOVERY', title: 'Reset link unavailable.', text: 'Customer password recovery is not configured yet. Requesting a reset link is currently unavailable, so no account changes have been made.' },
    verify: { kicker: 'EMAIL VERIFICATION', title: 'Email verification is not enabled.', text: 'Customer accounts can sign in without email verification at this time. We will update this page when verification email delivery is configured.' },
  }[kind]
  return <section className="auth-card auth-info-card">
    <img className="auth-card-logo" src="/culture-mark.png" alt="" />
    <span className="auth-kicker">{copy.kicker}</span><h1>{copy.title}</h1><p className="auth-description">{copy.text}</p>
    <Link className="button button-green auth-submit" to="/login">Back to sign in <ArrowRight size={16} /></Link>
  </section>
}
