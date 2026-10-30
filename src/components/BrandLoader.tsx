import { useEffect, useState } from 'react'

export default function BrandLoader({ label = 'Loading KitCulture' }: { label?: string }) {
  return <main className="kit-loader-screen" role="status" aria-live="polite" aria-label={label}>
    <div className="kit-loader-ball-wrap" aria-hidden="true"><span className="kit-loader-ball" /><span className="kit-loader-trail" /></div>
    <strong>KitCulture</strong>
    <span className="kit-loader-caption">{label}</span>
    <span className="kit-loader-track" aria-hidden="true"><span /></span>
  </main>
}

export function DelayedBrandLoader({ label, delayMs = 180 }: { label: string; delayMs?: number }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs])
  return visible ? <BrandLoader label={label} /> : null
}
