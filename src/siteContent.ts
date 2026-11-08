export const siteContentFields = [
  { key: 'terms', label: 'Terms and conditions', maxLength: 20_000 },
  { key: 'privacy', label: 'Privacy statement', maxLength: 20_000 },
  { key: 'kitzFooterDescription', label: 'KitCulture footer description', maxLength: 1_000 },
  { key: 'kitzFooterCopyright', label: 'KitCulture footer copyright', maxLength: 200 },
  { key: 'platformFooterNotice', label: 'Marketplace footer notice', maxLength: 500 },
] as const

export type SiteContentField = typeof siteContentFields[number]['key']
export type SiteContentData = Partial<Record<SiteContentField, string>>
export const siteContentQueryKey = ['store-site-content'] as const