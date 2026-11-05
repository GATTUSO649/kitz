import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function createSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function secretMatches(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function normalizeKenyanPhone(phone: string): string {
  const compact = phone.replace(/[\s()-]/g, '')
  const normalized = compact.startsWith('+254') ? compact.slice(1)
    : compact.startsWith('0') ? `254${compact.slice(1)}`
      : compact
  if (!/^254(?:7|1)\d{8}$/.test(normalized)) throw new Error('Enter a valid Kenyan mobile number.')
  return normalized
}

export function calculateFeeKes(priceKes: number, basisPoints: number): number {
  if (!Number.isSafeInteger(priceKes) || priceKes < 1) throw new Error('Price must be a positive whole KSh amount.')
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 1 || basisPoints > 10_000) throw new Error('Fee configuration is invalid.')
  const numerator = BigInt(priceKes) * BigInt(basisPoints)
  const fee = (numerator + 9_999n) / 10_000n
  const amount = Number(fee)
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Calculated fee is outside the supported range.')
  return amount
}

export function createListingReference(): string {
  return `MH-${randomBytes(8).toString('hex').toUpperCase()}`
}

export function createListingSlug(title: string, reference: string): string {
  const stem = title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 130) || 'listing'
  return `${stem}-${reference.toLowerCase()}`
}
