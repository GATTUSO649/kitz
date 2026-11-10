import { z } from 'zod'
import { normalizeKenyanPhone } from './security.js'

const inputSchema = z.object({
  facebookUrl: z.string().trim().max(2048).optional().default(''),
  xUrl: z.string().trim().max(2048).optional().default(''),
  youtubeUrl: z.string().trim().max(2048).optional().default(''),
  whatsappPhone: z.string().trim().max(24).optional().default(''),
  contactEmail: z.string().trim().max(254).optional().default(''),
  contactPhone: z.string().trim().max(24).optional().default(''),
})

function normalizeProfileUrl(value: string, hosts: string[]): string | null | undefined {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

export type MarketplaceSocialLinks = {
  facebookUrl: string | null
  xUrl: string | null
  youtubeUrl: string | null
  whatsappPhone: string | null
  whatsappUrl: string | null
  contactEmail: string | null
  contactPhone: string | null
}

export function parseMarketplaceSocialLinks(value: unknown): { success: true; data: MarketplaceSocialLinks } | { success: false; message: string } {
  const parsed = inputSchema.safeParse(value)
  if (!parsed.success) return { success: false, message: 'Enter valid social URLs and a Kenyan WhatsApp mobile number.' }
  const facebookUrl = normalizeProfileUrl(parsed.data.facebookUrl, ['facebook.com', 'fb.com'])
  const xUrl = normalizeProfileUrl(parsed.data.xUrl, ['x.com', 'twitter.com'])
  const youtubeUrl = normalizeProfileUrl(parsed.data.youtubeUrl, ['youtube.com', 'youtu.be'])
  const contactEmail = parsed.data.contactEmail ? parsed.data.contactEmail.toLowerCase() : null
  if (facebookUrl === undefined || xUrl === undefined || youtubeUrl === undefined
    || contactEmail && !z.string().email().safeParse(contactEmail).success) {
    return { success: false, message: 'Social links must use HTTPS and point to Facebook, X, or YouTube.' }
  }
  let whatsappPhone: string | null = null
  if (parsed.data.whatsappPhone) {
    try {
      whatsappPhone = normalizeKenyanPhone(parsed.data.whatsappPhone)
    } catch {
      return { success: false, message: 'Enter a valid Kenyan mobile number for WhatsApp.' }
    }
  }
  let contactPhone: string | null = null
  if (parsed.data.contactPhone) {
    try {
      contactPhone = normalizeKenyanPhone(parsed.data.contactPhone)
    } catch {
      return { success: false, message: 'Enter a valid Kenyan mobile number for the contact phone.' }
    }
  }
  return {
    success: true,
    data: {
      facebookUrl,
      xUrl,
      youtubeUrl,
      whatsappPhone,
      whatsappUrl: whatsappPhone ? `https://wa.me/${whatsappPhone}` : null,
      contactEmail,
      contactPhone,
    },
  }
}
