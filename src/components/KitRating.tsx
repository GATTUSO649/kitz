import { useState } from 'react'
import { Star } from 'lucide-react'

type RatingSummary = { ratingAverage: number; reviewCount: number }

function getVisitorId() {
  const key = 'kitculture-rating-visitor'
  let visitorId = localStorage.getItem(key)
  if (!visitorId) {
    visitorId = crypto.randomUUID()
    localStorage.setItem(key, visitorId)
  }
  return visitorId
}

export function KitRating({ productId, productName, rating = 0, count = 0 }: { productId: number; productName: string; rating?: number; count?: number }) {
  const [summary, setSummary] = useState<RatingSummary>({ ratingAverage: rating, reviewCount: count })
  const [hoveredRating, setHoveredRating] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [animationKey, setAnimationKey] = useState(0)

  async function rateKit(stars: number) {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/v1/products/${productId}/ratings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: stars, visitorId: getVisitorId() }),
      })
      const result = await response.json() as { data?: RatingSummary; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Your rating could not be saved.')
      setSummary(result.data)
      setAnimationKey((key) => key + 1)
      setMessage('Thanks for rating this kit.')
    } catch (issue) {
      setMessage(issue instanceof Error ? issue.message : 'Your rating could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const displayedRating = hoveredRating || Math.round(summary.ratingAverage)
  return <div className="product-rating product-rating-picker-card" onMouseLeave={() => setHoveredRating(0)}>
    <span className="product-rating-stars" role="group" aria-label={`Rate ${productName}`}>
      {[1, 2, 3, 4, 5].map((stars) => <button className={animationKey ? 'kit-rating-star is-rated' : 'kit-rating-star'} key={`${stars}-${animationKey}`} type="button" aria-label={`Rate ${productName} ${stars} ${stars === 1 ? 'star' : 'stars'}`} title={`${stars} ${stars === 1 ? 'star' : 'stars'}`} disabled={busy} onMouseEnter={() => setHoveredRating(stars)} onFocus={() => setHoveredRating(stars)} onBlur={() => setHoveredRating(0)} onClick={() => void rateKit(stars)}><Star size={14} fill={stars <= displayedRating ? 'currentColor' : 'none'} /></button>)}
    </span>
    {summary.reviewCount > 0 && <span className="product-rating-average">{summary.ratingAverage.toFixed(1)} ({summary.reviewCount})</span>}
    {message && <span className="kit-rating-message" role="status">{message}</span>}
  </div>
}