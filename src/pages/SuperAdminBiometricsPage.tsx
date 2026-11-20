import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { startAuthentication, startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser'
import { Check, Fingerprint, KeyRound, LockKeyhole, LogOut, ShieldCheck, X } from 'lucide-react'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server'
import '../super-admin-biometric.css'

type Phase = 'initializing' | 'idle' | 'scanning' | 'verifying' | 'success' | 'failed' | 'locked'
type BiometricStatus = {
  enrolled: boolean
  verified: boolean
  verifiedAt: string | null
  enrollmentAllowed: boolean
  lockedUntil: string | null
  attemptsRemaining: number
  fingerprintSpecific: false
}
type BiometricDevice = { id: number; credentialId: string; label: string; deviceType: string; backedUp: boolean; createdAt: string; lastUsedAt: string | null }
type ApiError = Error & { status?: number; code?: string }

async function biometricApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { code?: string; message?: string }; lockedUntil?: string }
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? 'Authenticator verification failed.') as ApiError
    error.status = response.status
    error.code = payload.error?.code
    if (response.status === 401) window.dispatchEvent(new Event('kitculture:admin-session-expired'))
    throw error
  }
  return payload.data as T
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Not verified in this session'
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function biometricLockIsActive(lockedUntil: string | null) {
  return Boolean(lockedUntil && Date.parse(lockedUntil) > Date.now())
}

function biometricLockDelay(lockedUntil: string) {
  return Math.max(0, Date.parse(lockedUntil) - Date.now())
}

export function SuperAdminBiometricsPage({ mode = 'verification' }: { mode?: 'enrollment' | 'verification' | 'devices' }) {
  const navigate = useNavigate()
  const operationRef = useRef(0)
  const [phase, setPhase] = useState<Phase>('initializing')
  const [status, setStatus] = useState<BiometricStatus | null>(null)
  const [devices, setDevices] = useState<BiometricDevice[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [label, setLabel] = useState('This device')
  const [revokeId, setRevokeId] = useState<number | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [browserSupport, setBrowserSupport] = useState<'checking' | 'supported' | 'unsupported'>('checking')

  async function loadStatus() {
    const [nextStatus, nextDevices] = await Promise.all([
      biometricApi<BiometricStatus>('/api/v1/super-admin/biometrics/status'),
      biometricApi<BiometricDevice[]>('/api/v1/super-admin/biometrics/devices'),
    ])
    setStatus(nextStatus)
    setDevices(nextDevices)
    const isLocked = biometricLockIsActive(nextStatus.lockedUntil)
    setPhase(isLocked ? 'locked' : nextStatus.verified ? 'success' : 'idle')
  }

  useEffect(() => {
    let mounted = true
    void Promise.all([
      biometricApi<BiometricStatus>('/api/v1/super-admin/biometrics/status'),
      biometricApi<BiometricDevice[]>('/api/v1/super-admin/biometrics/devices'),
    ]).then(([nextStatus, nextDevices]) => {
      if (!mounted) return
      setStatus(nextStatus)
      setDevices(nextDevices)
      const isLocked = biometricLockIsActive(nextStatus.lockedUntil)
      setPhase(isLocked ? 'locked' : nextStatus.verified ? 'success' : 'idle')
    }).catch((issue: unknown) => {
      if (!mounted) return
      setError(issue instanceof Error ? issue.message : 'Authenticator status could not be loaded.')
      setPhase('failed')
    })
    return () => {
      mounted = false
      operationRef.current += 1
      WebAuthnAbortService.cancelCeremony()
    }
  }, [])

  useEffect(() => {
    if (!window.isSecureContext || typeof window.PublicKeyCredential === 'undefined') {
      setBrowserSupport('unsupported')
      return
    }
    void window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      .then((available) => setBrowserSupport(available ? 'supported' : 'unsupported'))
      .catch(() => setBrowserSupport('unsupported'))
  }, [])

  useEffect(() => {
    if (!status?.lockedUntil) return
    const timer = window.setTimeout(() => {
      setStatus((current) => current ? { ...current, lockedUntil: null } : current)
      setPhase((current) => current === 'locked' ? 'idle' : current)
    }, biometricLockDelay(status.lockedUntil) + 50)
    return () => window.clearTimeout(timer)
  }, [status?.lockedUntil])

  async function beginCeremony(addDevice = false) {
    if (!status || busy) return
    if (browserSupport === 'unsupported') {
      setError('This browser or device does not support secure device verification. Open this page in a supported browser on the same device.')
      setPhase('failed')
      return
    }
    const operation = ++operationRef.current
    setBusy(true)
    setError('')
    setNotice('')
    setPhase('initializing')
    try {
      if (addDevice || !status.enrolled) {
        const options = await biometricApi<PublicKeyCredentialCreationOptionsJSON>('/api/v1/super-admin/biometrics/register/options', { method: 'POST', body: '{}' })
        if (operation !== operationRef.current) return
        setPhase('scanning')
        const credential = await startRegistration({ optionsJSON: options })
        if (operation !== operationRef.current) return
        setPhase('verifying')
        await biometricApi('/api/v1/super-admin/biometrics/register/verify', {
          method: 'POST',
          body: JSON.stringify({ response: credential, label: label.trim() || 'This device' }),
        })
      } else {
        const options = await biometricApi<PublicKeyCredentialRequestOptionsJSON>('/api/v1/super-admin/biometrics/authenticate/options', { method: 'POST', body: '{}' })
        if (operation !== operationRef.current) return
        setPhase('scanning')
        const assertion = await startAuthentication({ optionsJSON: options })
        if (operation !== operationRef.current) return
        setPhase('verifying')
        await biometricApi('/api/v1/super-admin/biometrics/authenticate/verify', {
          method: 'POST',
          body: JSON.stringify({ response: assertion }),
        })
      }
      if (operation !== operationRef.current) return
      await loadStatus()
      setNotice('Platform authenticator verified by the server. The authenticator does not disclose whether you used fingerprint, PIN, or face.')
    } catch (issue) {
      if (operation !== operationRef.current) return
      setError(issue instanceof Error ? issue.message : 'The authenticator could not be verified.')
      try {
        const [latestStatus, latestDevices] = await Promise.all([
          biometricApi<BiometricStatus>('/api/v1/super-admin/biometrics/status'),
          biometricApi<BiometricDevice[]>('/api/v1/super-admin/biometrics/devices'),
        ])
        setStatus(latestStatus)
        setDevices(latestDevices)
        const isLocked = biometricLockIsActive(latestStatus.lockedUntil)
        setPhase(isLocked ? 'locked' : 'failed')
      } catch {
        setPhase('failed')
      }
    } finally {
      if (operation === operationRef.current) setBusy(false)
    }
  }

  function cancelCeremony() {
    operationRef.current += 1
    WebAuthnAbortService.cancelCeremony()
    setBusy(false)
    setPhase('idle')
    setError('')
    setNotice('The browser authenticator prompt was cancelled. No verification was granted.')
  }

  async function revokeDevice(deviceId: number) {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const result = await biometricApi<{ revoked: number; remaining: number }>('/api/v1/super-admin/biometrics/revoke', {
        method: 'POST',
        body: JSON.stringify({ credentialId: devices.find((device) => device.id === deviceId)?.credentialId, password }),
      })
      setNotice(result.remaining
        ? `${result.revoked} authenticator${result.revoked === 1 ? '' : 's'} revoked. Verify with a remaining device before adding another.`
        : 'All authenticators revoked. Sign in again with your password to enroll a replacement.')
      setPassword('')
      setRevokeId(null)
      await loadStatus()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'The authenticator could not be revoked.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    try { await biometricApi('/api/v1/admin/logout', { method: 'POST', body: '{}' }) } catch {}
    navigate('/super-admin/login', { replace: true })
  }

  const locked = phase === 'locked'
  const active = phase === 'scanning' || phase === 'verifying' || phase === 'initializing'
  const statusLabel = phase === 'initializing' ? 'Preparing secure challenge'
    : phase === 'scanning' ? 'Waiting for your device authenticator'
      : phase === 'verifying' ? 'Validating signed response'
        : phase === 'success' ? 'Authenticator verified'
          : phase === 'locked' ? 'Verification temporarily locked'
            : phase === 'failed' ? 'Verification not completed'
              : status?.enrolled ? 'Ready for device verification' : 'Authenticator enrollment required'

  return <main className="sa-bio-shell">
    <header className="sa-bio-topbar">
      <a href="/super-admin" className="sa-bio-brand" aria-label="KitCulture IT Portal"><img src="/matrix-full-logo.png" alt="MATRIX" /><span>IT PORTAL</span></a>
      <span className="sa-bio-secure"><LockKeyhole size={15} /> SECURE ADMIN SESSION</span>
    </header>
    <section className="sa-bio-layout">
      <div className={`sa-bio-scanner is-${phase}`} aria-live="polite">
        <div className="sa-bio-orbit sa-bio-orbit-outer" />
        <div className="sa-bio-orbit sa-bio-orbit-inner" />
        <div className="sa-bio-scan-ring"><span className="sa-bio-scan-dot" /></div>
        <div className="sa-bio-fingerprint"><Fingerprint size={74} strokeWidth={1.2} /></div>
        {phase === 'success' && <span className="sa-bio-success-mark"><Check size={24} /></span>}
        {locked && <span className="sa-bio-lock-mark"><LockKeyhole size={23} /></span>}
      </div>
      <div className="sa-bio-content">
        <span className="sa-bio-eyebrow">KITCULTURE · SUPER-ADMIN</span>
        <h1>{mode === 'enrollment' ? 'Register your device verifier' : mode === 'devices' ? 'Registered device security' : 'Welcome back'}</h1>
        <p className="sa-bio-intro">{mode === 'enrollment'
          ? 'Register this laptop or Android device authenticator to protect your administrator account.'
          : mode === 'devices'
            ? 'Review registered authenticators and revoke access for devices you no longer use.'
            : 'Verify your identity to securely access your administration dashboard.'}</p>
        <div className={`sa-bio-status is-${phase}`} role="status"><i />{statusLabel}</div>
        <div className="sa-bio-progress" aria-label={`Verification state: ${statusLabel}`}><span className={phase !== 'idle' ? 'is-reached' : ''} /><span className={phase === 'verifying' || phase === 'success' ? 'is-reached' : ''} /><span className={phase === 'success' ? 'is-reached' : ''} /></div>
        <div className="sa-bio-note"><ShieldCheck size={17} /><span>Challenge expires after two minutes. Public-key signatures are checked server-side; no fingerprint images or templates are collected.</span></div>
        {status?.fingerprintSpecific === false && <p className="sa-bio-modality">WebAuthn confirms user verification by a platform authenticator, but does not reveal whether the device used fingerprint, PIN, or face. This page does not claim fingerprint-only verification.</p>}
        {error && <p className="sa-bio-message is-error" role="alert">{error}</p>}
        {notice && <p className="sa-bio-message is-notice" role="status">{notice}</p>}
        {locked && status?.lockedUntil && <p className="sa-bio-lock-copy">Retry after {new Date(status.lockedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Failed attempts are recorded in the administrator security log.</p>}
        {phase === 'initializing' && !status ? <div className="sa-bio-loading">Checking account security…</div> : null}
        {status && (mode === 'enrollment' || mode === 'devices' || !status.enrolled) && <label className="sa-bio-label">Device label<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={100} disabled={busy} /></label>}
        <div className="sa-bio-actions">
          {phase === 'success' ? <button className="sa-bio-primary is-success" type="button" onClick={() => navigate('/super-admin/dashboard', { replace: true })}><Check size={17} />Continue to IT Portal</button>
            : mode === 'enrollment' || mode === 'devices' || !status?.enrolled ? <button className="sa-bio-primary" type="button" onClick={() => void beginCeremony(mode === 'enrollment' || mode === 'devices')} disabled={busy || locked || browserSupport !== 'supported' || (mode === 'enrollment' && !status?.enrollmentAllowed)}><Fingerprint size={18} />{busy ? 'Enrolling…' : browserSupport === 'checking' ? 'Checking device support…' : browserSupport === 'unsupported' ? 'Fingerprint verifier unavailable' : phase === 'failed' ? 'Retry enrollment' : 'Register fingerprint'}</button>
              : <button className="sa-bio-primary" type="button" onClick={() => void beginCeremony()} disabled={busy || locked || browserSupport !== 'supported'}><Fingerprint size={18} />{busy ? 'Verifying…' : browserSupport === 'checking' ? 'Checking device support…' : browserSupport === 'unsupported' ? 'Fingerprint verifier unavailable' : phase === 'failed' ? 'Retry verification' : 'Verify with fingerprint'}</button>}
          {active && <button className="sa-bio-secondary" type="button" onClick={cancelCeremony}><X size={16} />Cancel</button>}
          {status?.enrolled && status.verified && <button className="sa-bio-secondary" type="button" onClick={() => void beginCeremony(true)} disabled={busy}><KeyRound size={16} />Add device</button>}
        </div>
        {status && !status.enrolled && !status.enrollmentAllowed && <p className="sa-bio-recovery">For security, enrollment requires a recent password sign-in. Sign out and sign in again to enroll a replacement authenticator.</p>}
        {devices.length > 0 && <section className="sa-bio-devices"><div className="sa-bio-devices-heading"><strong>Registered devices</strong><span>{devices.length}</span></div>{devices.map((device) => <article className="sa-bio-device" key={device.id}><div><strong>{device.label}</strong><small>{device.deviceType === 'singleDevice' ? 'This device' : 'Synced authenticator'} · Last used {formatTimestamp(device.lastUsedAt)}</small></div>{revokeId === device.id ? <div className="sa-bio-revoke"><input aria-label="Confirm password to revoke" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Confirm password" /><button type="button" onClick={() => void revokeDevice(device.id)} disabled={busy || !password}><Check size={14} />Confirm</button><button type="button" aria-label="Cancel revocation" onClick={() => { setRevokeId(null); setPassword('') }}><X size={14} /></button></div> : <button className="sa-bio-revoke-trigger" type="button" onClick={() => setRevokeId(device.id)} disabled={busy}>Revoke</button>}</article>)}</section>}
        <div className="sa-bio-footer"><span><LockKeyhole size={13} /> Verification expires after five minutes for critical actions</span><button type="button" onClick={() => void signOut()}><LogOut size={14} />Sign out</button></div>
      </div>
    </section>
  </main>
}
