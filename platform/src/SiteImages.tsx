import { createContext, useContext, useEffect, useState, type ImgHTMLAttributes, type PropsWithChildren, type ReactNode } from 'react'

const platformImageSlots = [
  'platform-brand-logo',
  'platform-favicon',
  'platform-home-background',
  'platform-kits-card',
  'platform-marketplace-card',
  'platform-auth-background',
  'platform-intro-background',
] as const

type PlatformImageSlot = typeof platformImageSlots[number]
type SiteImageOverrides = Partial<Record<PlatformImageSlot, string>>
type SiteContentField = 'terms' | 'privacy' | 'platformFooterNotice'
type SiteContentOverrides = Partial<Record<SiteContentField, string>>
const SiteImagesContext = createContext<{ images: SiteImageOverrides; content: SiteContentOverrides }>({ images: {}, content: {} })

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
  const [content, setContent] = useState<SiteContentOverrides>({})

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
    fetch(new URL('/api/v1/store/site-content', kitzOrigin), { signal: controller.signal, credentials: 'omit' })
      .then(async (response) => {
        const result = await response.json() as { data?: Record<string, unknown> }
        if (!response.ok || !result.data) return
        const fields: SiteContentField[] = ['terms', 'privacy', 'platformFooterNotice']
        setContent(Object.fromEntries(fields.flatMap((field) => typeof result.data?.[field] === 'string' ? [[field, result.data[field] as string]] : [])) as SiteContentOverrides)
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
    let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!favicon) {
      favicon = document.createElement('link')
      favicon.rel = 'icon'
      document.head.append(favicon)
    }
    const defaultFavicon = favicon.dataset.defaultHref ?? favicon.href
    const defaultFaviconType = favicon.dataset.defaultType ?? favicon.type
    favicon.dataset.defaultHref = defaultFavicon
    favicon.dataset.defaultType = defaultFaviconType
    const customFavicon = images['platform-favicon']
    favicon.href = customFavicon ?? defaultFavicon
    if (customFavicon) favicon.removeAttribute('type')
    else if (defaultFaviconType) favicon.type = defaultFaviconType
  }, [images])

  return <SiteImagesContext.Provider value={{ images, content }}>{children}</SiteImagesContext.Provider>
}

export function SiteImage({ slot, fallback, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { slot: PlatformImageSlot; fallback: string }) {
  const { images } = useContext(SiteImagesContext)
  return <img {...props} src={images[slot] ?? fallback} />
}

export function SiteContentValue({ field, fallback }: { field: SiteContentField; fallback: string }) {
  const { content } = useContext(SiteImagesContext)
  return content[field] || fallback
}

export function SiteContentParagraphs({ field, fallback }: { field: 'terms' | 'privacy'; fallback: ReactNode }) {
  const { content } = useContext(SiteImagesContext)
  const text = content[field]?.trim()
  if (!text) return <>{fallback}</>
  return <>{text.split(/\n\s*\n/).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 20)}`}>{paragraph}</p>)}</>
}