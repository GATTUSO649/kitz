import { FaWhatsapp } from 'react-icons/fa6'
import { createWhatsAppProductMessage, getWhatsAppProductImageUrl, type WhatsAppProduct } from './whatsapp-product'
import { useNotifications } from './notification-api'

export function WhatsAppProductLink({ phone, product }: { phone: string; product: WhatsAppProduct }) {
  if (!phone) return null
  const { notify } = useNotifications()
  const imageUrl = getWhatsAppProductImageUrl(product, window.location.origin)

  async function shareProduct() {
    if (!imageUrl) {
      notify('This kit does not have an image available to attach.', 'warning')
      return
    }
    if (typeof navigator.share !== 'function' || typeof File === 'undefined') {
      notify('This browser cannot attach images to WhatsApp. Try sharing from a phone or a browser that supports file sharing.', 'warning')
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
      notify('The kit image could not be attached. Try sharing from a phone or another browser.', 'warning')
    }
  }

  return <div className="whatsapp-product-actions">
    <button className="whatsapp-product-link" type="button" onClick={() => void shareProduct()} aria-label={`Share ${product.name} image and details on WhatsApp`}>
      <FaWhatsapp className="whatsapp-product-icon" size={18} aria-hidden="true" />
      WhatsApp
    </button>
  </div>
}