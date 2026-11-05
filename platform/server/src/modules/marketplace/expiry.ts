import { and, eq, lte } from 'drizzle-orm'
import { database } from '../../database/connection.js'
import { marketplaceProducts } from '../../database/schema.js'

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

export async function expireDueMarketplaceListings(now = new Date()): Promise<number> {
  if (!database) return 0
  const expired = await database.update(marketplaceProducts)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(marketplaceProducts.status, 'published'), lte(marketplaceProducts.expiresAt, now)))
    .returning({ id: marketplaceProducts.id })
  return expired.length
}

export function startMarketplaceExpiryWorker(): () => void {
  let running = false
  const expire = async () => {
    if (running) return
    running = true
    try {
      const count = await expireDueMarketplaceListings()
      if (count > 0) console.info('MarketHub listings expired', { count })
    } catch (error) {
      console.error('MarketHub listing expiry worker failed', { errorType: error instanceof Error ? error.name : 'unknown' })
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => { void expire() }, 60_000)
  timer.unref()
  void expire()
  return () => clearInterval(timer)
}