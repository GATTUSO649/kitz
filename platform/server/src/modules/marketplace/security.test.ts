import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyCallbackToken } from '../payments/daraja.js'
import { parseMarketplaceSocialLinks } from './social-links.js'
import { calculateFeeKes, createListingReference, createListingSlug, createSecret, hashSecret, normalizeKenyanPhone, secretMatches } from './security.js'

test('normalizes valid Kenyan phone numbers and rejects invalid input', () => {
  assert.equal(normalizeKenyanPhone('0712 345 678'), '254712345678')
  assert.equal(normalizeKenyanPhone('+254 112 345 678'), '254112345678')
  assert.throws(() => normalizeKenyanPhone('12345'))
})

test('calculates KSh fees using integer rounding', () => {
  assert.equal(calculateFeeKes(20_000, 1_000), 2_000)
  assert.equal(calculateFeeKes(20_000, 500), 1_000)
  assert.equal(calculateFeeKes(1, 500), 1)
})

test('creates unpredictable opaque references and hashes bearer secrets', () => {
  const secret = createSecret()
  const hash = hashSecret(secret)
  assert.equal(secretMatches(secret, hash), true)
  assert.equal(secretMatches(`${secret}x`, hash), false)
  assert.match(createListingReference(), /^MH-[A-F0-9]{16}$/)
  assert.match(createListingSlug('Blue Sofa!', 'MH-ABC123'), /^blue-sofa-mh-abc123$/)
})

test('callback tokens require an exact constant-time checked match', () => {
  assert.equal(verifyCallbackToken('private-callback-token', 'private-callback-token'), true)
  assert.equal(verifyCallbackToken('wrong-token', 'private-callback-token'), false)
})

test('footer social settings allow only HTTPS network URLs and normalize Kenya WhatsApp numbers', () => {
  const parsed = parseMarketplaceSocialLinks({
    facebookUrl: 'https://facebook.com/markethub',
    xUrl: 'https://x.com/markethub',
    youtubeUrl: 'https://youtu.be/channel',
    whatsappPhone: '0712 345 678',
    contactEmail: 'HELLO@MARKETHUB.CO.KE',
    contactPhone: '0711 222 333',
  })
  assert.equal(parsed.success, true)
  if (parsed.success) {
    assert.equal(parsed.data.whatsappPhone, '254712345678')
    assert.equal(parsed.data.whatsappUrl, 'https://wa.me/254712345678')
    assert.equal(parsed.data.contactEmail, 'hello@markethub.co.ke')
    assert.equal(parsed.data.contactPhone, '254711222333')
  }
  assert.equal(parseMarketplaceSocialLinks({ facebookUrl: 'https://facebook.com.evil.test/page' }).success, false)
  assert.equal(parseMarketplaceSocialLinks({ xUrl: 'http://x.com/markethub' }).success, false)
  assert.equal(parseMarketplaceSocialLinks({ whatsappPhone: '12345' }).success, false)
  assert.equal(parseMarketplaceSocialLinks({ contactEmail: 'not-an-email' }).success, false)
  assert.equal(parseMarketplaceSocialLinks({ contactPhone: '12345' }).success, false)
})
