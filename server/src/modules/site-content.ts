import { z } from 'zod'

export const siteContentFields = [
  'terms',
  'privacy',
  'kitzFooterDescription',
  'kitzFooterCopyright',
  'platformFooterNotice',
] as const

export type SiteContentField = typeof siteContentFields[number]

export const siteContentSchema = z.object({
  terms: z.string().max(20_000),
  privacy: z.string().max(20_000),
  kitzFooterDescription: z.string().max(1_000),
  kitzFooterCopyright: z.string().max(200),
  platformFooterNotice: z.string().max(500),
}).strict()

export function isSiteContentField(value: string): value is SiteContentField {
  return siteContentFields.some((field) => field === value)
}