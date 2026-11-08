import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { siteImageSlots, siteImagesQueryKey, type SiteImageSlotKey } from '../siteImages'

async function fetchSiteImages(signal?: AbortSignal): Promise<Record<string, string>> {
  const response = await fetch('/api/v1/store/site-images', { signal })
  const result = await response.json() as { data?: Record<string, string>; error?: { message?: string } }
  if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Site images are unavailable.')
  return result.data
}

function useSiteImages() {
  return useQuery({ queryKey: siteImagesQueryKey, queryFn: ({ signal }) => fetchSiteImages(signal), staleTime: 5 * 60_000 })
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
  }, [imagesQuery.data])
  return null
}