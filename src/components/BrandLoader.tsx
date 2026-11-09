import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { SiteImage } from './SiteImages'

export default function BrandLoader({ label = 'Loading MATRIX' }: { label?: string }) {
  return <main className="kit-loader-screen" role="status" aria-live="polite" aria-label={label}>
    <div className="kit-loader-mark" aria-hidden="true">
      <SiteImage className="kit-loader-logo-full" slot="platform-brand-logo" fallback="/matrix-logo.png" alt="" />
      <SiteImage className="kit-loader-logo-monogram" slot="platform-brand-logo" fallback="/matrix-logo.png" alt="" />
      <span className="kit-loader-orbit" />
    </div>
    <span className="kit-loader-caption">{label}</span>
    <span className="kit-loader-track" aria-hidden="true"><span /></span>
  </main>
}

export function RouteTransitionLoader() {
  const { pathname } = useLocation()
  const [transition, setTransition] = useState({ pathname, active: false })

  if (transition.pathname !== pathname) setTransition({ pathname, active: true })

  useEffect(() => {
    if (!transition.active) return
    const transitionPath = transition.pathname
    const timer = window.setTimeout(() => {
      setTransition((current) => current.pathname === transitionPath ? { ...current, active: false } : current)
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [transition.active, transition.pathname])

  return transition.active ? <BrandLoader label="Loading next page" /> : null
}

export function DelayedBrandLoader({ label, delayMs = 180 }: { label: string; delayMs?: number }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs])
  return visible ? <BrandLoader label={label} /> : null
}
