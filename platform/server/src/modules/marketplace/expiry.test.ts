import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_LISTING_EXPIRY_DAYS, expireDueMarketplaceListings, listingExpiryAt, resolveListingExpiryDays } from './expiry.js'

test('listing expiry defaults to seven days and accepts bounded administrator settings', () => {
  assert.equal(resolveListingExpiryDays(undefined), DEFAULT_LISTING_EXPIRY_DAYS)
  assert.equal(resolveListingExpiryDays(30), 30)
  assert.equal(resolveListingExpiryDays(0), DEFAULT_LISTING_EXPIRY_DAYS)
  assert.equal(resolveListingExpiryDays(366), DEFAULT_LISTING_EXPIRY_DAYS)
})

test('listing expiry is calculated from verified publication time', () => {
  const publishedAt = new Date('2026-11-06T12:00:00.000Z')
  assert.equal(listingExpiryAt(publishedAt, 7).toISOString(), '2026-11-13T12:00:00.000Z')
})

test('expiry processing updates only due published rows and is repeatable', async () => {
  const dueIds = ['due-listing-1', 'due-listing-2']
  let updateValues: Record<string, unknown> = {}
  let whereCalls = 0
  const fakeDatabase = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateValues = values
        return {
          where: () => {
            whereCalls += 1
            return { returning: async () => dueIds.splice(0).map((id) => ({ id })) }
          },
        }
      },
    }),
  } as unknown as NonNullable<Parameters<typeof expireDueMarketplaceListings>[1]>
  const runAt = new Date('2026-11-06T12:00:00.000Z')
  assert.equal(await expireDueMarketplaceListings(runAt, fakeDatabase), 2)
  assert.deepEqual(updateValues, { status: 'expired', updatedAt: runAt })
  assert.equal(await expireDueMarketplaceListings(runAt, fakeDatabase), 0)
  assert.equal(whereCalls, 2)
})