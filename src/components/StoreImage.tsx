import { useState } from 'react'

type StoreImageProps = {
  src: string | null | undefined
  alt: string
  className?: string
  loading?: 'eager' | 'lazy'
  width: number
  height: number
  priority?: boolean
  sizes?: string
}

function optimizedImageSource(src: string, size: number) {
  try {
    const url = new URL(src)
    if (url.hostname === 'res.cloudinary.com' && url.pathname.includes('/image/upload/')) {
      return src.replace('/image/upload/', `/image/upload/f_auto,q_auto,w_${size},c_limit/`)
    }
    if (url.hostname === 'assets.adidas.com' && /\/images\/w_\d+/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/(\/images\/)w_\d+/, `$1w_${size}`)
      return url.href
    }
    return undefined
  } catch {
    return undefined
  }
}

function cloudinaryResponsiveSources(src: string) {
  const sources = [320, 640, 960, 1280].map((size) => {
    const source = optimizedImageSource(src, size)
    return source ? `${source} ${size}w` : null
  })
  return sources.every(Boolean) ? sources.join(', ') : undefined
}

export function StoreImage({ src, alt, className, loading = 'lazy', width, height, priority = false, sizes = '(max-width: 700px) 50vw, (max-width: 1100px) 40vw, 25vw' }: StoreImageProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  if (!src || failedSource === src) return <div className={`store-image-fallback${className ? ` ${className}` : ''}`} role="img" aria-label={alt || 'Kit image unavailable'}><span>KC</span></div>
  const optimizedSource = optimizedImageSource(src, priority ? 1280 : 640)
  return <img
    className={className}
    src={optimizedSource ?? src}
    alt={alt}
    width={width}
    height={height}
    srcSet={cloudinaryResponsiveSources(src)}
    sizes={sizes}
    loading={priority ? 'eager' : loading}
    fetchPriority={priority ? 'high' : 'auto'}
    decoding="async"
    onError={() => setFailedSource(src)}
  />
}
