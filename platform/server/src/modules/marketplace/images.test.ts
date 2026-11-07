import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getMarketplaceImageStorageReadiness, inspectImage } from './images.js'

function pngHeader(width: number, height: number) {
  const buffer = Buffer.alloc(24)
  buffer.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

test('image inspection checks content signature and dimensions', () => {
  assert.deepEqual(inspectImage(pngHeader(800, 600)), { contentType: 'image/png', width: 800, height: 600 })
  assert.throws(() => inspectImage(Buffer.from('not an image')))
  assert.throws(() => inspectImage(pngHeader(80, 80)))
  assert.throws(() => inspectImage(pngHeader(6000, 6000)))
})

test('image storage readiness reports missing variable names without values', () => {
  assert.deepEqual(getMarketplaceImageStorageReadiness({}), {
    status: 'misconfigured',
    missingVariables: ['MARKETPLACE_CLOUDINARY_CLOUD_NAME', 'MARKETPLACE_CLOUDINARY_API_KEY', 'MARKETPLACE_CLOUDINARY_API_SECRET'],
  })
  assert.deepEqual(getMarketplaceImageStorageReadiness({
    MARKETPLACE_CLOUDINARY_CLOUD_NAME: 'cloud-name',
    MARKETPLACE_CLOUDINARY_API_KEY: 'api-key',
    MARKETPLACE_CLOUDINARY_API_SECRET: 'api-secret',
  }), { status: 'ready', missingVariables: [] })
})
