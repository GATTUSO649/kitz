import { and, eq, lte } from 'drizzle-orm'
import { database } from '../../database/connection.js'
import { marketplaceProducts } from '../../database/schema.js'
import { setWorkerEnabled } from '../../workers/health.js'
import { startScheduledWorker } from '../../workers/scheduler.js'

export const DEFAULT_LISTING_EXPIRY_DAYS = 7
export const MAX_LISTING_EXPIRY_DAYS = 365

export function resolveListingExpiryDays(value: unknown): number {
  const days = Number(value)
  return Number.isSafeInteger(days) && days >= 1 && days <= MAX_LISTING_EXPIRY_DAYS
    ? days
    : DEFAULT_LISTING_EXPIRY_DAYS
}

export function listingExpiryAt(publishedAt: Date, durationDays: unknown): Date {
  return new Date(publishedAt.getTime() + resolveListingExpiryDays(durationDays) * 24 * 60 * 60 * 1000)
}

type ExpiryDatabase = NonNullable<typeof database>

export async function expireDueMarketplaceListings(now = new Date(), databaseClient: ExpiryDatabase | null = database): Promise<number> {
  if (!databaseClient) return 0
  try {
    const expired = await databaseClient.update(marketplaceProducts)
      .set({ status: 'expired', updatedAt: now })
      .where(and(eq(marketplaceProducts.status, 'published'), lte(marketplaceProducts.expiresAt, now)))
      .returning({ id: marketplaceProducts.id })
    return expired.length
  } catch (error) {
    throw Object.assign(new Error('Listing expiry database operation failed.', { cause: error }), { operation: 'expire_due_listings', category: 'database' as const })
  }
}

export function startMarketplaceExpiryWorker(): () => void {
  if (!database) {
    setWorkerEnabled('marketplace_listing_expiry', false)
    return () => undefined
  }
  return startScheduledWorker('marketplace_listing_expiry', { intervalMs: 60_000, maximumBackoffMs: 15 * 60_000 }, async () => {
    const expiredCount = await expireDueMarketplaceListings()
    if (expiredCount > 0) console.info('MarketHub listings expired', { worker: 'marketplace_listing_expiry', processedCount: expiredCount })
    return expiredCount
  })
}