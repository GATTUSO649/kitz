import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_LISTING_EXPIRY_DAYS, listingExpiryAt, resolveListingExpiryDays } from './expiry.js'

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