import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { siteImageSlots, siteImagesQueryKey, type SiteImageSlotKey } from '../siteImages'
import { siteContentQueryKey, type SiteContentData, type SiteContentField } from '../siteContent'

async function fetchSiteImages(signal?: AbortSignal): Promise<Record<string, string>> {
  const response = await fetch('/api/v1/store/site-images', { signal })
  const result = await response.json() as { data?: Record<string, string>; error?: { message?: string } }
  if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Site images are unavailable.')
  return result.data
}

function useSiteImages() {
  return useQuery({ queryKey: siteImagesQueryKey, queryFn: ({ signal }) => fetchSiteImages(signal), staleTime: 5 * 60_000 })
}

function useSiteContent() {
  return useQuery({
    queryKey: siteContentQueryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/v1/store/site-content', { signal })
      const result = await response.json() as { data?: SiteContentData; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Site content is unavailable.')
      return result.data
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function SiteImage({ slot, fallback, ...props }: Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { slot: SiteImageSlotKey; fallback: string }) {
  const imagesQuery = useSiteImages()
  return <img {...props} src={imagesQuery.data?.[slot] ?? fallback} />
}

export function SiteImageVariables() {
  const imagesQuery = useSiteImages()
  useEffect(() => {
    for (const { key } of siteImageSlots) {
      const imageUrl = imagesQuery.data?.[key]
      if (!imageUrl) {
        document.documentElement.style.removeProperty(`--site-image-${key}`)
        continue
      }
      try {
        const url = new URL(imageUrl)
        if (url.protocol === 'https:' && url.hostname === 'res.cloudinary.com') {
          document.documentElement.style.setProperty(`--site-image-${key}`, `url(${url.href})`)
        }
      } catch {
        document.documentElement.style.removeProperty(`--site-image-${key}`)
      }
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
    const customFavicon = imagesQuery.data?.['platform-favicon']
    favicon.href = customFavicon ?? defaultFavicon
    if (customFavicon) favicon.removeAttribute('type')
    else if (defaultFaviconType) favicon.type = defaultFaviconType
  }, [imagesQuery.data])
  return null
}

export function SiteContentValue({ field, fallback }: { field: SiteContentField; fallback: string }) {
  const contentQuery = useSiteContent()
  return contentQuery.data?.[field] || fallback
}