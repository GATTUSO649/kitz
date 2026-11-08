import { createContext, useContext, useEffect, useState, type ImgHTMLAttributes, type PropsWithChildren } from 'react'

const platformImageSlots = [
  'platform-brand-logo',
  'platform-home-background',
  'platform-kits-card',
  'platform-marketplace-card',
  'platform-auth-background',
  'platform-intro-background',
] as const

type PlatformImageSlot = typeof platformImageSlots[number]
type SiteImageOverrides = Partial<Record<PlatformImageSlot, string>>
const SiteImagesContext = createContext<SiteImageOverrides>({})

function isCloudinaryImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com'
      && !url.username && !url.password && !url.port
  } catch {
    return false
  }
}

export function SiteImagesProvider({ children }: PropsWithChildren) {
  const [images, setImages] = useState<SiteImageOverrides>({})

  useEffect(() => {
    const controller = new AbortController()
    const kitzOrigin = import.meta.env.VITE_KITZ_ORIGIN || 'https://kitz.onrender.com'
    fetch(new URL('/api/v1/store/site-images', kitzOrigin), { signal: controller.signal, credentials: 'omit' })
      .then(async (response) => {
        const result = await response.json() as { data?: Record<string, unknown> }
        if (!response.ok || !result.data) return
        const entries = platformImageSlots.flatMap((slot) => isCloudinaryImageUrl(result.data?.[slot]) ? [[slot, result.data[slot] as string]] : [])
        setImages(Object.fromEntries(entries) as SiteImageOverrides)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    for (const slot of platformImageSlots) {
      const imageUrl = images[slot]
      if (!imageUrl) {
        document.documentElement.style.removeProperty(`--site-image-${slot}`)
        continue
      }
      document.documentElement.style.setProperty(`--site-image-${slot}`, `url(${imageUrl})`)
    }
  }, [images])

  return <SiteImagesContext.Provider value={images}>{children}</SiteImagesContext.Provider>
}

export function SiteImage({ slot, fallback, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { slot: PlatformImageSlot; fallback: string }) {
  const images = useContext(SiteImagesContext)
  return <img {...props} src={images[slot] ?? fallback} />
}