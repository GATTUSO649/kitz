export const siteContentFields = [
  { key: 'terms', label: 'Terms and conditions', maxLength: 20_000 },
  { key: 'privacy', label: 'Privacy statement', maxLength: 20_000 },
  { key: 'kitzFooterDescription', label: 'KitCulture footer description', maxLength: 1_000 },
  { key: 'kitzFooterCopyright', label: 'KitCulture footer copyright', maxLength: 200 },
  { key: 'platformFooterNotice', label: 'Marketplace footer notice', maxLength: 500 },
  { key: 'platformFacebookUrl', label: 'MarketHub Facebook URL', maxLength: 2048 },
  { key: 'platformXUrl', label: 'MarketHub X URL', maxLength: 2048 },
  { key: 'platformYoutubeUrl', label: 'MarketHub YouTube URL', maxLength: 2048 },
  { key: 'platformWhatsappPhone', label: 'MarketHub WhatsApp phone', maxLength: 24 },
  { key: 'platformContactEmail', label: 'MarketHub contact email', maxLength: 254 },
  { key: 'platformContactPhone', label: 'MarketHub contact phone', maxLength: 24 },
] as const

export type SiteContentField = typeof siteContentFields[number]['key']
export type SiteContentData = Partial<Record<SiteContentField, string>>
export const siteContentQueryKey = ['store-site-content'] as const