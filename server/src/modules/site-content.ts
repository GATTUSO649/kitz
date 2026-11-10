import { z } from 'zod'

const socialProfileUrl = (hosts: string[]) => z.string().trim().max(2048).refine((value) => {
  if (!value) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}, 'Use an HTTPS profile URL for the matching social network.')

export const siteContentFields = [
  'terms',
  'privacy',
  'kitzFooterDescription',
  'kitzFooterCopyright',
  'platformFooterNotice',
  'platformFacebookUrl',
  'platformXUrl',
  'platformYoutubeUrl',
  'platformWhatsappPhone',
  'platformContactEmail',
  'platformContactPhone',
] as const

export type SiteContentField = typeof siteContentFields[number]

export const siteContentSchema = z.object({
  terms: z.string().max(20_000),
  privacy: z.string().max(20_000),
  kitzFooterDescription: z.string().max(1_000),
  kitzFooterCopyright: z.string().max(200),
  platformFooterNotice: z.string().max(500),
  platformFacebookUrl: socialProfileUrl(['facebook.com', 'fb.com']).optional().default(''),
  platformXUrl: socialProfileUrl(['x.com', 'twitter.com']).optional().default(''),
  platformYoutubeUrl: socialProfileUrl(['youtube.com', 'youtu.be']).optional().default(''),
  platformWhatsappPhone: z.string().trim().max(24).refine((value) => !value || /^(?:0[17]\d{8}|\+?254[17]\d{8})$/.test(value.replace(/[\s()-]/g, '')), 'Enter a valid Kenyan WhatsApp mobile number.').optional().default(''),
  platformContactEmail: z.string().trim().max(254).refine((value) => !value || z.string().email().safeParse(value).success, 'Enter a valid public contact email.').optional().default(''),
  platformContactPhone: z.string().trim().max(24).refine((value) => !value || /^(?:0[17]\d{8}|\+?254[17]\d{8})$/.test(value.replace(/[\s()-]/g, '')), 'Enter a valid Kenyan contact phone number.').optional().default(''),
}).strict()

export function isSiteContentField(value: string): value is SiteContentField {
  return siteContentFields.some((field) => field === value)
}