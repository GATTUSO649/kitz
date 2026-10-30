import { FaWhatsapp } from 'react-icons/fa6'
import { createWhatsAppProductHref, createWhatsAppProductMessage, getWhatsAppProductImageUrl, type WhatsAppProduct } from './whatsapp-product'
import { useNotifications } from './notification-api'

function supportsImageSharing() {
  if (typeof navigator === 'undefined' || typeof File === 'undefined' || !navigator.share || !navigator.canShare) return false
  return navigator.canShare({ files: [new File([], 'kitculture-share-check.jpg', { type: 'image/jpeg' })] })
}

export function WhatsAppProductLink({ phone, product }: { phone: string; product: WhatsAppProduct }) {
  const { notify } = useNotifications()
  if (!phone) return null
  const imageUrl = getWhatsAppProductImageUrl(product, window.location.origin)
  const href = createWhatsAppProductHref(phone, product)
  if (!href) return null

  async function shareImage() {
    if (!imageUrl) return
    try {
      const response = await fetch(imageUrl, { mode: 'cors' })
      if (!response.ok) throw new Error('Image request failed')
      const blob = await response.blob()
      if (!blob.type.startsWith('image/')) throw new Error('Image format is unavailable')
      const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg'
      const file = new File([blob], `${product.slug}.${extension}`, { type: blob.type })
      if (!navigator.canShare?.({ files: [file] })) throw new Error('Image sharing is unavailable')
      await navigator.share({ files: [file], title: product.name, text: createWhatsAppProductMessage(product) })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      notify('This image could not be shared from your browser. You can still ask KitCulture about the kit on WhatsApp.', 'warning')
    }
  }

  return <div className="whatsapp-product-actions">
    <a className="whatsapp-product-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Ask KitCulture about ${product.name} on WhatsApp`}>
      <FaWhatsapp className="whatsapp-product-icon" size={18} aria-hidden="true" />
      WhatsApp
    </a>
    {imageUrl && supportsImageSharing() && <button className="whatsapp-product-share" type="button" onClick={() => void shareImage()} aria-label={`Share ${product.name} image and details`}>
      Share image
    </button>}
  </div>
}