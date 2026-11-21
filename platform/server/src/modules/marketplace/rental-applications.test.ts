import assert from 'node:assert/strict'
import test from 'node:test'
import { applicationReference, shopSlugFromName } from './rental-applications.js'

test('shop rental references are opaque and non-empty', () => {
  const first = applicationReference()
  const second = applicationReference()
  assert.match(first, /^MR-[A-F0-9]{16}$/)
  assert.notEqual(first, second)
})

test('shop slugs are normalized safely', () => {
  assert.equal(shopSlugFromName('  Nairobi Fashion Hub  '), 'nairobi-fashion-hub')
  assert.equal(shopSlugFromName('Mama & Sons / Textiles'), 'mama-sons-textiles')
})
