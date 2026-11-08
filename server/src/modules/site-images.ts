export const siteImageSlotKeys = [
  'kitz-home-hero',
  'kitz-home-jersey-lineup',
  'kitz-portal-background',
  'kitz-admin-background',
  'kitz-auth-background',
  'kitz-auth-form-background',
  'kitz-collection-background',
  'kitz-story-background',
  'platform-brand-logo',
  'platform-favicon',
  'platform-home-background',
  'platform-kits-card',
  'platform-marketplace-card',
  'platform-auth-background',
  'platform-intro-background',
  'kitz-favicon',
] as const

export type SiteImageSlot = typeof siteImageSlotKeys[number]

export function isSiteImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com'
      && !url.username && !url.password && !url.port
  } catch {
    return false
  }
}