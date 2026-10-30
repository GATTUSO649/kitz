import { useQuery } from '@tanstack/react-query'

export type WhatsAppProduct = {
  name: string
  slug: string
  price: string | number
  salePrice?: string | number | null
  imageUrl?: string | null
  images?: { imageUrl: string; isPrimary: boolean; sortOrder?: number }[]
  category?: { name: string } | null
  team?: { name: string } | null
  league?: { name: string } | null
  jerseyCategory?: { name: string } | null
  variants: { size: string; stock: number }[]
}

export function normalizeWhatsAppNumber(value: string) {
  const digits = value.replace(/\D/g, '')
  const international = digits.startsWith('0') ? `254${digits.slice(1)}` : digits
  return /^254[17]\d{8}$/.test(international) ? international : null
}

export function getWhatsAppProductImageUrl(product: WhatsAppProduct, origin: string) {
  const imageUrl = product.imageUrl ?? product.images?.find((image) => image.isPrimary)?.imageUrl ?? product.images?.[0]?.imageUrl
  return imageUrl ? new URL(imageUrl, origin).href : null
}

export function createWhatsAppProductMessage(product: WhatsAppProduct) {
  const price = Number(product.salePrice ?? product.price)
  const formattedPrice = Number.isFinite(price)
    ? new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(price)
    : 'Please confirm current price'
  const availableSizes = product.variants.map(({ size, stock }) => `${size} (${stock} available)`).join(', ') || 'Please confirm sizes'
  const totalStock = product.variants.reduce((total, variant) => total + variant.stock, 0)
  const details = [
    `Hi KitCulture, I'm interested in ${product.name}.`,
    `Price: ${formattedPrice}`,
    product.team?.name ? `Team: ${product.team.name}` : '',
    product.league?.name ? `League: ${product.league.name}` : '',
    product.jerseyCategory?.name ? `Jersey type: ${product.jerseyCategory.name}` : '',
    product.category?.name ? `Collection: ${product.category.name}` : '',
    `Sizes and stock: ${availableSizes}`,
    `Total available: ${totalStock}`,
  ].filter(Boolean).join('\n')
  return details
}

export function createWhatsAppProductHref(phone: string, product: WhatsAppProduct) {
  const recipient = normalizeWhatsAppNumber(phone)
  if (!recipient) return null

  return `https://wa.me/${recipient}?text=${encodeURIComponent(createWhatsAppProductMessage(product))}`
}

export function useStoreWhatsAppNumber(enabled = true) {
  const contactQuery = useQuery({
    queryKey: ['store-contact'],
    enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/v1/store/contact', { signal })
      const result = await response.json() as { data?: { whatsappNumber?: string }; error?: { message?: string } }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Store contact details are unavailable.')
      return result.data.whatsappNumber ?? ''
    },
  })
  return contactQuery.data ?? ''
}