import { createWhatsAppProductHref, type WhatsAppProduct } from './whatsapp-product'

export function WhatsAppProductLink({ phone, product }: { phone: string; product: WhatsAppProduct }) {
  if (!phone) return null
  const href = createWhatsAppProductHref(phone, product, window.location.origin)
  if (!href) return null

  return <a className="whatsapp-product-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Ask KitCulture about ${product.name} on WhatsApp`}>
    <span className="whatsapp-product-mark" aria-hidden="true">WA</span>
    Ask on WhatsApp
  </a>
}