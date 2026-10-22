import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { Link } from 'react-router-dom'

export function CustomerAuthForm({
  mode,
  busy,
  error,
  registered,
  email,
  returnTo,
  onSubmit,
}: {
  mode: 'login' | 'register'
  busy: boolean
  error: string
  registered: boolean
  email: string
  returnTo: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const isRegister = mode === 'register'
  const authQuery = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''

  return <form className="auth-card" onSubmit={onSubmit} noValidate>
    <img className="auth-card-logo" src="/culture-mark.png" alt="" />
    <span className="auth-kicker">{isRegister ? 'JOIN THE CULTURE' : 'WELCOME BACK'}</span>
    <h1>{isRegister ? 'Create your account.' : 'Sign in to KitCulture.'}</h1>
    <p className="auth-description">{isRegister ? 'Create an account to keep your orders and favourite kits together.' : 'Your orders, favourites, and delivery details are ready when you are.'}</p>
    {registered && !isRegister && <p className="auth-feedback success" role="status">Account created. Sign in with your new details to continue.</p>}
    {isRegister && <label>Full name<input autoComplete="name" name="fullName" required minLength={2} maxLength={160} /></label>}
    <label>Email address<input autoComplete="email" name="email" type="email" required maxLength={254} defaultValue={email} /></label>
    <label className="auth-password-field">Password<span className="auth-password-control"><input autoComplete={isRegister ? 'new-password' : 'current-password'} name="password" type={showPassword ? 'text' : 'password'} required minLength={isRegister ? 12 : 1} maxLength={128} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
    {!isRegister && <div className="auth-forgot-row"><Link to="/forgot-password">Forgot password?</Link></div>}
    {isRegister && <label className="auth-password-field">Confirm password<span className="auth-password-control"><input autoComplete="new-password" name="passwordConfirmation" type={showConfirmation ? 'text' : 'password'} required minLength={12} maxLength={128} /><button type="button" aria-label={showConfirmation ? 'Hide confirmation password' : 'Show confirmation password'} aria-pressed={showConfirmation} onClick={() => setShowConfirmation((visible) => !visible)}>{showConfirmation ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>}
    {error && <p className="auth-feedback" role="alert">{error}</p>}
    <button className="button button-green auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></button>
    <p className="auth-switch">{isRegister ? 'Already have an account?' : 'New to KitCulture?'} <Link to={isRegister ? `/login${authQuery}` : `/signup${authQuery}`}>{isRegister ? 'Sign in' : 'Create account'}</Link></p>
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
