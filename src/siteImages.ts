export const siteImageSlots = [
  { key: 'kitz-home-hero', label: 'Storefront hero', description: 'Fallback photo shown when no homepage slide is active.' },
  { key: 'kitz-home-jersey-lineup', label: 'Homepage jersey lineup', description: 'Image shown behind the jersey lineup when no products are available.' },
  { key: 'kitz-portal-background', label: 'Customer portal background', description: 'Background image on the customer portal.' },
  { key: 'kitz-admin-background', label: 'Admin sign-in background', description: 'Background image on administrator sign-in.' },
  { key: 'kitz-auth-background', label: 'Account sign-in background', description: 'Large photo panel on account sign-in and recovery pages.' },
  { key: 'kitz-auth-form-background', label: 'Account form background', description: 'Background image behind account forms.' },
  { key: 'kitz-collection-background', label: 'Collection background', description: 'Background image behind the collection feature.' },
  { key: 'kitz-story-background', label: 'Story background', description: 'Background image used in the KitCulture story sections.' },
  { key: 'platform-brand-logo', label: 'Platform MATRIX logo', description: 'Visible MATRIX logo across the marketplace platform.' },
  { key: 'platform-favicon', label: 'Platform favicon', description: 'Browser tab icon for MarketHub.' },
  { key: 'platform-home-background', label: 'Platform home backdrop', description: 'Backdrop behind the platform destination cards.' },
  { key: 'platform-kits-card', label: 'Football kits card', description: 'Image for the football kits destination card.' },
  { key: 'platform-marketplace-card', label: 'Second-hand marketplace card', description: 'Image for the second-hand destination card and marketplace hero.' },
  { key: 'platform-auth-background', label: 'Platform sign-in background', description: 'Background image on marketplace admin and seller sign-in.' },
  { key: 'platform-intro-background', label: 'Platform intro background', description: 'Background image for the platform intro animation.' },
] as const

export type SiteImageSlotKey = typeof siteImageSlots[number]['key']
export const siteImagesQueryKey = ['store-site-images'] as const