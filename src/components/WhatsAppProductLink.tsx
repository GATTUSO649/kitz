import { FaWhatsapp } from 'react-icons/fa6'
import { createWhatsAppProductHref, createWhatsAppProductMessage, getWhatsAppProductImageUrl, type WhatsAppProduct } from './whatsapp-product'

export function WhatsAppProductLink({ phone, product }: { phone: string; product: WhatsAppProduct }) {
  if (!phone) return null
  const imageUrl = getWhatsAppProductImageUrl(product, window.location.origin)
  const href = createWhatsAppProductHref(phone, product, imageUrl)
  if (!href) return null
  const directChatHref = href

  async function shareProduct() {
    if (!imageUrl || typeof navigator.share !== 'function' || typeof File === 'undefined') {
      window.open(directChatHref, '_blank', 'noopener,noreferrer')
      return
    }

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
      window.location.assign(directChatHref)
    }
  }

  return <div className="whatsapp-product-actions">
    <button className="whatsapp-product-link" type="button" onClick={() => void shareProduct()} aria-label={`Share ${product.name} image and details on WhatsApp`}>
      <FaWhatsapp className="whatsapp-product-icon" size={18} aria-hidden="true" />
      WhatsApp
    </button>
  </div>
}